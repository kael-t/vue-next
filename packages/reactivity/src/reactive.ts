import { isObject, toRawType } from '@vue/shared'
import { mutableHandlers, readonlyHandlers } from './baseHandlers'
import {
  mutableCollectionHandlers,
  readonlyCollectionHandlers
} from './collectionHandlers'
import { ReactiveEffect } from './effect'
import { UnwrapRef, Ref } from './ref'
import { makeMap } from '@vue/shared'

// The main WeakMap that stores {target -> key -> dep} connections.
// Conceptually, it's easier to think of a dependency as a Dep class
// which maintains a Set of subscribers, but we simply store them as
// raw Sets to reduce memory overhead.
// Dep就是旧的Dep类, 但是换成了Set来保存, 减少内存的使用, 就是用来收集依赖的
// 这3个是用来保存Dep和target之间的相互关系的
// Dep就是一系列的观察者, KeyToDepMap
// targetMap保存的是target -> DepMaps的关联
export type Dep = Set<ReactiveEffect>
export type KeyToDepMap = Map<any, Dep>
export const targetMap = new WeakMap<any, KeyToDepMap>()

// WeakMaps that store {raw <-> observed} pairs.
// WeakMap保存raw(原值)和reactive(响应对象)对
// 即可以从原值得到响应式对象, 也可以通过响应式对象获取到原值, 同时防止proxy再次被proxy
const rawToReactive = new WeakMap<any, any>()
const reactiveToRaw = new WeakMap<any, any>()
// 保存raw(原值)readonly(只读对象)对
// 即可以从原值得到只读对象, 也可以通过只读对象获取到原值
// TODO: 这里的readonly为vue内置的readonly?
const rawToReadonly = new WeakMap<any, any>()
const readonlyToRaw = new WeakMap<any, any>()

// WeakSets for values that are marked readonly or non-reactive during
// observable creation.
// 在设置响应时创建才被标记为readonly的, 保存在WeakSet中
// TODO: 用户设置的readonly
const readonlyValues = new WeakSet<any>()
const nonReactiveValues = new WeakSet<any>()

// 集合类型: Set/Map/WeakSet/WeakMap, 响应式值的类型'[object {Object|Array|Map|Set|WeakMap|WeakSet}]'
const collectionTypes = new Set<Function>([Set, Map, WeakMap, WeakSet])
const isObservableType = /*#__PURE__*/ makeMap(
  'Object,Array,Map,Set,WeakMap,WeakSet'
)

// 判断这个value是否能够设置为响应式的
// 要求: 
// 1. 不是Vue实例
// 2. 不是VNode
// 3. 是Object|Array|Map|Set|WeakMap|WeakSet类型的
// 4. 不在nonReactiveValues中(没有被标记为非响应式的)
const canObserve = (value: any): boolean => {
  return (
    !value._isVue &&
    !value._isVNode &&
    isObservableType(toRawType(value)) &&
    !nonReactiveValues.has(value)
  )
}

// only unwrap nested ref
type UnwrapNestedRefs<T> = T extends Ref ? T : UnwrapRef<T>

export function reactive<T extends object>(target: T): UnwrapNestedRefs<T>
export function reactive(target: object) {
  // if trying to observe a readonly proxy, return the readonly version.
  // 如果target是只读的, 那么就直接返回只读的
  if (readonlyToRaw.has(target)) {
    return target
  }
  // target is explicitly marked as readonly by user
  // target被用户明确的标记为readonly的
  if (readonlyValues.has(target)) {
    return readonly(target)
  }
  // 经过前面两步就可以断定target为费制度数据

  // 创建响应式对象(reactive)
  return createReactiveObject(
    target,
    rawToReactive,
    reactiveToRaw,
    mutableHandlers,
    mutableCollectionHandlers
  )
}

export function readonly<T extends object>(
  target: T
): Readonly<UnwrapNestedRefs<T>> {
  // value is a mutable observable, retrieve its original and return
  // a readonly version.
  // 如果target已经是一个响应式对象了, 那么先通过weakMap找回它的原值再返回一个只读版本的值
  if (reactiveToRaw.has(target)) {
    target = reactiveToRaw.get(target)
  }
  // 创建响应式对象(readonly)
  return createReactiveObject(
    target,
    rawToReadonly,
    readonlyToRaw,
    readonlyHandlers,
    readonlyCollectionHandlers
  )
}

/**
 * 创建响应式对象, readonly和reactive都是调用的这个函数, 只是他们的参数不同
 * @param target 目标对象
 * @param toProxy 响应式对象存储的weakMap
 * @param toRaw 原值存储的weakMap
 * @param baseHandlers 
 * @param collectionHandlers 
 */
function createReactiveObject(
  target: unknown,
  toProxy: WeakMap<any, any>,
  toRaw: WeakMap<any, any>,
  baseHandlers: ProxyHandler<any>,
  collectionHandlers: ProxyHandler<any>
) {
  // 如果不是对象的话(基本类型), 不需要为基本类型设置Proxy, 在__DEV__下报错
  if (!isObject(target)) {
    if (__DEV__) {
      console.warn(`value cannot be made reactive: ${String(target)}`)
    }
    return target
  }
  // target already has corresponding Proxy
  let observed = toProxy.get(target)
  // target已经有相应的响应式对象了, 那就不用再新建, 直接在toProxy(响应式对象的WeakMap[reactiveToRaw | readonlyToRaw])里面拿
  if (observed !== void 0) {
    return observed
  }
  // target is already a Proxy
  // 如果target已经是一个Proxy了的话, 就直接返回这个target就好了
  if (toRaw.has(target)) {
    return target
  }
  // only a whitelist of value types can be observed.
  // 如果不在能设置成响应式的白名单之内的, 直接返回target
  if (!canObserve(target)) {
    return target
  }
  // 如果响应式的对象是Map|Set|WeakMap|WeakSet的话, 采用collectionHandlers
  // Object|Array采用baseHandlers
  const handlers = collectionTypes.has(target.constructor)
    ? collectionHandlers
    : baseHandlers
  // 给原对象设置Proxy, 
  observed = new Proxy(target, handlers)
  // 设置原对象和响应式对象/只读对象的映射
  // 响应式: rawToReactive, reactiveToRaw
  // 只读: rawToReadonly, readonlyToRaw
  toProxy.set(target, observed)
  toRaw.set(observed, target)
  // 如果targetMap中不包含当前处理的target的话
  // 为target新建Map
  if (!targetMap.has(target)) {
    targetMap.set(target, new Map())
  }
  return observed
}

// value是否为响应式的(在reactiveToRaw和readonlyToRaw两个WeakMap中查看是否有该值)
export function isReactive(value: unknown): boolean {
  return reactiveToRaw.has(value) || readonlyToRaw.has(value)
}

// value是否为readonly的(在readonlyToRaw中查看是否包含该值)
export function isReadonly(value: unknown): boolean {
  return readonlyToRaw.has(value)
}

// 获取原值(从reactiveToRaw或者readonlyToRaw中取值, 没取到的话说明不是响应式的, 直接返回原值)
export function toRaw<T>(observed: T): T {
  return reactiveToRaw.get(observed) || readonlyToRaw.get(observed) || observed
}

// 标记为readonly(用户标记的都放在readonlyValues中)
export function markReadonly<T>(value: T): T {
  readonlyValues.add(value)
  return value
}

// 标记非响应式(放在nonReactiveValues中)
export function markNonReactive<T>(value: T): T {
  nonReactiveValues.add(value)
  return value
}
