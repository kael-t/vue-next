// global immutability lock
// 全局的不变性锁
export let LOCKED = true

export function lock() {
  LOCKED = true
}

export function unlock() {
  LOCKED = false
}
