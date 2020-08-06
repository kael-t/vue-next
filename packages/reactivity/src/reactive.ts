import { isObject, toRawType, def, hasOwn, makeMap } from '@vue/shared'
import {
  mutableHandlers,
  readonlyHandlers,
  shallowReactiveHandlers,
  shallowReadonlyHandlers
} from './baseHandlers'
import {
  mutableCollectionHandlers,
  readonlyCollectionHandlers,
  shallowCollectionHandlers
} from './collectionHandlers'
import { UnwrapRef, Ref } from './ref'

// 定义一些属性枚举
export const enum ReactiveFlags {
  SKIP = '__v_skip',
  IS_REACTIVE = '__v_isReactive',
  IS_READONLY = '__v_isReadonly',
  RAW = '__v_raw',
  REACTIVE = '__v_reactive',
  READONLY = '__v_readonly'
}

// 定义一些属性标识
interface Target {
  [ReactiveFlags.SKIP]?: boolean // Vue3的VNode都带有__v_skip: true标识, 该属性为true说明是Vue3的VNode
  [ReactiveFlags.IS_REACTIVE]?: boolean // 标识是否是响应式的
  [ReactiveFlags.IS_READONLY]?: boolean // 标识是否是只读的
  [ReactiveFlags.RAW]?: any
  [ReactiveFlags.REACTIVE]?: any
  [ReactiveFlags.READONLY]?: any
}

// 集合类型: Set/Map/WeakSet/WeakMap, 响应式值的类型'[object {Object|Array|Map|Set|WeakMap|WeakSet}]'
const collectionTypes = new Set<Function>([Set, Map, WeakMap, WeakSet])
const isObservableType = /*#__PURE__*/ makeMap(
  'Object,Array,Map,Set,WeakMap,WeakSet'
)

// 判断这个value是否能够设置为响应式的
// 要求:
// 1. 不是VNode
// 2. 是Object|Array|Map|Set|WeakMap|WeakSet类型的
// 3. 没有被冻结(传入对象没有被frozen)
const canObserve = (value: Target): boolean => {
  return (
    !value[ReactiveFlags.SKIP] &&
    isObservableType(toRawType(value)) &&
    Object.isExtensible(value)
  )
}

// only unwrap nested ref
type UnwrapNestedRefs<T> = T extends Ref ? T : UnwrapRef<T>

export function reactive<T extends object>(target: T): UnwrapNestedRefs<T>
export function reactive(target: object) {
  // if trying to observe a readonly proxy, return the readonly version.
  // 如果对已经是readonly的响应式对象进行reactive, 直接返回readonly版本的对象
  if (target && (target as Target)[ReactiveFlags.IS_READONLY]) {
    return target
  }
  // 创建reactive响应式对象
  return createReactiveObject(
    target,
    false,
    mutableHandlers,
    mutableCollectionHandlers
  )
}

// Return a reactive-copy of the original object, where only the root level
// properties are reactive, and does NOT unwrap refs nor recursively convert
// returned properties.
// 创建shallowReactive响应式对象, 只有最上层的属性是响应式的, 不会解包ref也不会递归将深层的属性转换成响应式
export function shallowReactive<T extends object>(target: T): T {
  return createReactiveObject(
    target,
    false,
    shallowReactiveHandlers,
    shallowCollectionHandlers
  )
}

type Primitive = string | number | boolean | bigint | symbol | undefined | null
type Builtin = Primitive | Function | Date | Error | RegExp
export type DeepReadonly<T> = T extends Builtin
  ? T
  : T extends Map<infer K, infer V>
    ? ReadonlyMap<DeepReadonly<K>, DeepReadonly<V>>
    : T extends ReadonlyMap<infer K, infer V>
      ? ReadonlyMap<DeepReadonly<K>, DeepReadonly<V>>
      : T extends WeakMap<infer K, infer V>
        ? WeakMap<DeepReadonly<K>, DeepReadonly<V>>
        : T extends Set<infer U>
          ? ReadonlySet<DeepReadonly<U>>
          : T extends ReadonlySet<infer U>
            ? ReadonlySet<DeepReadonly<U>>
            : T extends WeakSet<infer U>
              ? WeakSet<DeepReadonly<U>>
              : T extends Promise<infer U>
                ? Promise<DeepReadonly<U>>
                : T extends {}
                  ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
                  : Readonly<T>

export function readonly<T extends object>(
  target: T
): DeepReadonly<UnwrapNestedRefs<T>> {
  return createReactiveObject(
    target,
    true,
    readonlyHandlers,
    readonlyCollectionHandlers
  )
}

// Return a reactive-copy of the original object, where only the root level
// properties are readonly, and does NOT unwrap refs nor recursively convert
// returned properties.
// This is used for creating the props proxy object for stateful components.
export function shallowReadonly<T extends object>(
  target: T
): Readonly<{ [K in keyof T]: UnwrapNestedRefs<T[K]> }> {
  return createReactiveObject(
    target,
    true,
    shallowReadonlyHandlers,
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
  target: Target,
  isReadonly: boolean,
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
  // target is already a Proxy, return it.
  // exception: calling readonly() on a reactive object
  if (
    target[ReactiveFlags.RAW] &&
    !(isReadonly && target[ReactiveFlags.IS_REACTIVE])
  ) {
    return target
  }
  // target already has corresponding Proxy
  const reactiveFlag = isReadonly
    ? ReactiveFlags.READONLY
    : ReactiveFlags.REACTIVE
  if (hasOwn(target, reactiveFlag)) {
    return target[reactiveFlag]
  }
  // only a whitelist of value types can be observed.
  // 如果不在能设置成响应式的白名单之内的, 直接返回target
  if (!canObserve(target)) {
    return target
  }
  const observed = new Proxy(
    target,
    collectionTypes.has(target.constructor) ? collectionHandlers : baseHandlers
  )
  // 把创建的响应式对象存在对应的__v_reactive 或 __v_readonly中
  def(target, reactiveFlag, observed)
  return observed
}

// value是否为响应式的(先看下__v_isReadonly是true还是false, true的话看下value原值是否是响应式的, false的话直接返回value的__v_isReactive标志)
// TODO: 对响应式对象设置readonly代理?? 对readonly对象再做readonly代理??? 千层塔???
export function isReactive(value: unknown): boolean {
  if (isReadonly(value)) {
    return isReactive((value as Target)[ReactiveFlags.RAW])
  }
  return !!(value && (value as Target)[ReactiveFlags.IS_REACTIVE])
}

// value是否为readonly的(查看__v_isReadonly的值)
export function isReadonly(value: unknown): boolean {
  return !!(value && (value as Target)[ReactiveFlags.IS_READONLY])
}

// 简单说就是__v_isReactive/__v_isReadonly标志有一个为true的就是isProxy
export function isProxy(value: unknown): boolean {
  return isReactive(value) || isReadonly(value)
}

// 取得代理对象的原值
export function toRaw<T>(observed: T): T {
  return (
    (observed && toRaw((observed as Target)[ReactiveFlags.RAW])) || observed
  )
}

// 把__v_skip标志设置成true, 表明这个对象不会被vue劫持代理, 也就是标志这个值为raw的
export function markRaw<T extends object>(value: T): T {
  def(value, ReactiveFlags.SKIP, true)
  return value
}
