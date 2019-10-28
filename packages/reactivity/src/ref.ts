import { track, trigger } from './effect'
import { OperationTypes } from './operations'
import { isObject } from '@vue/shared'
import { reactive } from './reactive'
import { ComputedRef } from './computed'
import { CollectionTypes } from './collectionHandlers'

// 定义Ref接口
export interface Ref<T = any> {
  _isRef: true
  value: UnwrapRef<T>
}

// 把对象转换成proxy base的响应式对象, 不是对象返回原值
const convert = <T extends unknown>(val: T): T =>
  isObject(val) ? reactive(val) : val

export function ref<T extends Ref>(raw: T): T
export function ref<T>(raw: T): Ref<T>
export function ref(raw: unknown) {
  if (isRef(raw)) {
    return raw
  }
  // 把原对象转换成响应式对象
  raw = convert(raw)
  // 返回一个Ref实例
  // 包含一个refSymbol属性, 标识为ref的实例
  // 包含一个value属性, 可以存取
  const r = {
    _isRef: true,
    get value() {
      track(r, OperationTypes.GET, '')
      return raw
    },
    set value(newVal) {
      raw = convert(newVal)
      trigger(r, OperationTypes.SET, '')
    }
  }
  return r as Ref
}

// 判断是否为Ref的实例, 其实就是查看对象的refSymbol是否为true
export function isRef(r: any): r is Ref {
  return r ? r._isRef === true : false
}

// 转成Ref实例
// 把传入的object中的每一项都转成ref, 嵌套内层对象的并不会转成ref
// 为什么嵌套的内层对象不用转成refs, 因为Refs是为了基本类型而生的, 内层的object已经是响应式的了
export function toRefs<T extends object>(
  object: T
): { [K in keyof T]: Ref<T[K]> } {
  const ret: any = {}
  for (const key in object) {
    ret[key] = toProxyRef(object, key)
  }
  return ret
}

// 这里的getter和setter不需要调用track和trigger是因为object已经是响应式对象
// 也就是给他直接赋值就会触发object的getter和setter, 然后触发track和trigger
function toProxyRef<T extends object, K extends keyof T>(
  object: T,
  key: K
): Ref<T[K]> {
  return {
    _isRef: true,
    get value(): any {
      return object[key]
    },
    set value(newVal) {
      object[key] = newVal
    }
  }
}

// Recursively unwraps nested value bindings.
export type UnwrapRef<T> = {
  cRef: T extends ComputedRef<infer V> ? UnwrapRef<V> : T
  // 如果T是Ref实例的话, 递归解套
  ref: T extends Ref<infer V> ? UnwrapRef<V> : T
  // 如果T是Array的实例的话, 循环递归解套
  array: T extends Array<infer V> ? Array<UnwrapRef<V>> : T
  // 如果T是Object的话, 遍历递归解套
  object: { [K in keyof T]: UnwrapRef<T[K]> }
}[T extends ComputedRef<any>
  ? 'cRef'
  : T extends Ref
    ? 'ref'
    : T extends Array<any>
      ? 'array'
      : T extends Function | CollectionTypes
        ? 'ref' // bail out on types that shouldn't be unwrapped
        : T extends object ? 'object' : 'ref']
