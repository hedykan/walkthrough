// 生成测试用的样例仓库：一个虚构的 Go 支付服务 api-service。
// 用固定的作者和时间提交，所以每次生成的提交哈希都一样；结果打包成 api-service.bundle，测试时克隆到临时目录。
//
//   node test/fixtures/build-fixture.mjs
//
// 历史：
//   init ── base「支付与退款」 ── 加订单锁 ── 退款也加锁(head) ── docs(main)
//                               └──── feature/payment-lock ────┘（已合入 main）
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'api-service.bundle');

const GO_MOD = `module example.com/api-service

go 1.22
`;

const GATEWAY = `package payment

import "context"

// Gateway 调用第三方支付网关扣款。演示用，只记录每笔订单被扣了几次。
type Gateway struct {
	Charged map[string]int
}

// Charge 向支付网关发起一次扣款。
func (g *Gateway) Charge(ctx context.Context, orderID string, amount int64) error {
	if g.Charged == nil {
		g.Charged = map[string]int{}
	}
	g.Charged[orderID]++
	return nil
}
`;

const FEE = `package engine

// CalcFee 计算一笔支付的手续费，单位：分。
func CalcFee(amount int64, rate float64) int64 {
	if amount <= 0 {
		return 0
	}
	fee := int64(float64(amount) * rate)
	if fee < 1 {
		return 1
	}
	return fee
}
`;

const HANDLER = `package api

import (
	"context"

	"example.com/api-service/internal/payment"
	"example.com/api-service/internal/refund"
)

// PaymentHandler 接收支付请求：POST /orders/:id/pay
type PaymentHandler struct {
	payments *payment.Service
}

// Pay 是支付接口的入口。
func (h *PaymentHandler) Pay(ctx context.Context, orderID string) error {
	return h.payments.PayOrder(ctx, orderID)
}

// RefundHandler 接收退款请求：POST /orders/:id/refund
type RefundHandler struct {
	refunds *refund.Service
}

// Refund 是退款接口的入口。
func (h *RefundHandler) Refund(ctx context.Context, orderID string) error {
	return h.refunds.RefundOrder(ctx, orderID)
}
`;

const repo = (paidGuard, refundGuard) => `package payment

import (
	"context"
	"errors"
	"sync"
)

// ErrNotFound 表示订单不存在。
var ErrNotFound = errors.New("order not found")
${refundGuard ? `
// ErrAlreadyRefunded 表示订单已经退过款。
var ErrAlreadyRefunded = errors.New("order already refunded")
` : ''}
// Order 是一笔订单。
type Order struct {
	ID       string
	Amount   int64 // 金额，单位：分
	Paid     bool
	Refunded bool
}

// Repository 保存订单，演示用内存实现。
type Repository struct {
	mu     sync.Mutex
	orders map[string]*Order
}

// NewRepository 创建一个空仓库。
func NewRepository() *Repository {
	return &Repository{orders: map[string]*Order{}}
}

// LoadOrder 按 ID 读取订单的一份拷贝。
func (r *Repository) LoadOrder(ctx context.Context, id string) (Order, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	o, ok := r.orders[id]
	if !ok {
		return Order{}, ErrNotFound
	}
	return *o, nil
}

// MarkPaid 把订单标记为已支付。
func (r *Repository) MarkPaid(ctx context.Context, id string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	o, ok := r.orders[id]
	if !ok {
		return ErrNotFound
	}
${paidGuard ? `	if o.Paid {
		return ErrAlreadyPaid
	}
` : ''}	o.Paid = true
	return nil
}

// MarkRefunded 把订单标记为已退款。
func (r *Repository) MarkRefunded(ctx context.Context, id string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	o, ok := r.orders[id]
	if !ok {
		return ErrNotFound
	}
${refundGuard ? `	if o.Refunded {
		return ErrAlreadyRefunded
	}
` : ''}	o.Refunded = true
	return nil
}
`;

const SERVICE_BASE = `package payment

import (
	"context"
	"errors"
)

// ErrAlreadyPaid 表示订单已经支付过，不能再扣款。
var ErrAlreadyPaid = errors.New("order already paid")

// Service 负责订单支付。
type Service struct {
	repo    *Repository
	gateway *Gateway
}

// NewService 组装支付服务。
func NewService(repo *Repository, gateway *Gateway) *Service {
	return &Service{repo: repo, gateway: gateway}
}

// PayOrder 为订单扣款。
func (s *Service) PayOrder(ctx context.Context, orderID string) error {
	order, err := s.repo.LoadOrder(ctx, orderID)
	if err != nil {
		return err
	}
	if order.Paid {
		return ErrAlreadyPaid
	}
	if err := s.gateway.Charge(ctx, order.ID, order.Amount); err != nil {
		return err
	}
	return s.repo.MarkPaid(ctx, order.ID)
}
`;

const SERVICE_HEAD = `package payment

import (
	"context"
	"errors"
	"time"
)

// ErrAlreadyPaid 表示订单已经支付过，不能再扣款。
var ErrAlreadyPaid = errors.New("order already paid")

// LockTTL 是订单锁的最长持有时间：进程崩溃没来得及释放的锁，过了这个时间也能被别人拿到。
const LockTTL = 30 * time.Second

// Service 负责订单支付。
type Service struct {
	repo    *Repository
	gateway *Gateway
	locks   *Locker
}

// NewService 组装支付服务。
func NewService(repo *Repository, gateway *Gateway, locks *Locker) *Service {
	return &Service{repo: repo, gateway: gateway, locks: locks}
}

// PayOrder 为订单扣款。
// 「是否已支付」的检查和扣款必须在同一把订单锁里完成，否则两个并发请求可能同时通过检查。
func (s *Service) PayOrder(ctx context.Context, orderID string) error {
	release, err := s.locks.Acquire(ctx, orderID, LockTTL)
	if err != nil {
		return err
	}
	defer release()

	order, err := s.repo.LoadOrder(ctx, orderID)
	if err != nil {
		return err
	}
	if order.Paid {
		return ErrAlreadyPaid
	}
	if err := s.gateway.Charge(ctx, order.ID, order.Amount); err != nil {
		return err
	}
	return s.repo.MarkPaid(ctx, order.ID)
}
`;

const LOCK = `package payment

import (
	"context"
	"errors"
	"sync"
	"time"
)

// ErrLocked 表示订单正被另一个请求处理。
var ErrLocked = errors.New("order is locked by another request")

// Locker 是按订单 ID 加的互斥锁，带超时。演示用内存实现，生产环境换成 Redis 等分布式锁。
type Locker struct {
	mu    sync.Mutex
	until map[string]time.Time
}

// NewLocker 创建一个锁管理器。
func NewLocker() *Locker {
	return &Locker{until: map[string]time.Time{}}
}

// Acquire 尝试拿到订单锁；锁被占用且没过期时返回 ErrLocked。
// 返回的 release 必须调用，通常写成 defer release()。
func (l *Locker) Acquire(ctx context.Context, orderID string, ttl time.Duration) (release func(), err error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	if until, ok := l.until[orderID]; ok && !expired(until, now) {
		return nil, ErrLocked
	}
	l.until[orderID] = now.Add(ttl)
	return func() { l.Release(orderID) }, nil
}

// Release 释放订单锁。重复释放是安全的。
func (l *Locker) Release(orderID string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.until, orderID)
}

// expired 判断锁是否已经超时。
func expired(until, now time.Time) bool {
	return !now.Before(until)
}
`;

const REFUND = (head) => `package refund

import (
	"context"

	"example.com/api-service/internal/payment"
)

// Service 负责订单退款。
type Service struct {
	repo  *payment.Repository
${head ? `	locks *payment.Locker
` : ''}}

// NewService 组装退款服务。
${head ? `func NewService(repo *payment.Repository, locks *payment.Locker) *Service {
	return &Service{repo: repo, locks: locks}
}` : `func NewService(repo *payment.Repository) *Service {
	return &Service{repo: repo}
}`}

// RefundOrder 为已支付的订单退款。
func (s *Service) RefundOrder(ctx context.Context, orderID string) error {
${head ? `	release, err := s.locks.Acquire(ctx, orderID, payment.LockTTL)
	if err != nil {
		return err
	}
	defer release()

` : ''}	order, err := s.repo.LoadOrder(ctx, orderID)
	if err != nil {
		return err
	}
	if !order.Paid || order.Refunded {
		return nil
	}
	return s.repo.MarkRefunded(ctx, orderID)
}
`;

const README = `# api-service

演示用的支付服务：下单、支付、退款。仅用于代码走读插件的测试。
`;

const ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Demo', GIT_AUTHOR_EMAIL: 'demo@example.com',
  GIT_COMMITTER_NAME: 'Demo', GIT_COMMITTER_EMAIL: 'demo@example.com',
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null',
};
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-service-'));
const git = (...args) => execFileSync('git', args, { cwd: dir, env: ENV, encoding: 'utf8' }).trim();
const write = (files) => {
  for (const [p, body] of Object.entries(files)) {
    const f = path.join(dir, p);
    if (body === null) { fs.rmSync(f); continue; }
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, body);
  }
};
let day = 0;
const commit = (msg) => {
  const when = `2026-10-${String(10 + day++).padStart(2, '0')}T10:00:00+08:00`;
  git('add', '-A');
  execFileSync('git', ['commit', '-q', '-m', msg], { cwd: dir, env: { ...ENV, GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when } });
  return git('rev-parse', 'HEAD');
};

git('init', '-q', '-b', 'main');
write({ 'go.mod': GO_MOD, 'internal/payment/gateway.go': GATEWAY, 'internal/payment/engine/fee.go': FEE });
const init = commit('init: payment gateway and fee');
write({ 'internal/payment/repository.go': repo(false, false), 'internal/payment/service.go': SERVICE_BASE, 'internal/refund/service.go': REFUND(false), 'internal/api/handler.go': HANDLER });
const base = commit('feat: pay and refund orders');
git('checkout', '-q', '-b', 'feature/payment-lock');
write({ 'internal/payment/lock.go': LOCK, 'internal/payment/service.go': SERVICE_HEAD, 'internal/payment/repository.go': repo(true, false) });
const lock = commit('fix: take the order lock before charging');
write({ 'internal/refund/service.go': REFUND(true), 'internal/payment/repository.go': repo(true, true) });
const head = commit('fix: refund takes the order lock too');
git('checkout', '-q', 'main');
git('merge', '-q', '--ff-only', 'feature/payment-lock');
write({ 'README.md': README });
const docs = commit('docs: add README');

fs.rmSync(OUT, { force: true });
git('bundle', 'create', OUT, '--all');
console.log(JSON.stringify({ init, base, lock, head, docs, dir }, null, 2));
