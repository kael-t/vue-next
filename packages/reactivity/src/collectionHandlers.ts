import { toRaw, reactive, readonly } from './reactive'
import { track, trigger } from './effect'
import { OperationTypes } from './operations'
import { LOCKED } from './lock'
import { isObject, capitalize, hasOwn, hasChanged } from '@vue/shared'

/**
 * NOTICE: 这里的大前提是collectionHandlers, 也就是WeakMap/WeakSet/Map/Set类型Proxy的handlers
 */

// 定义类型
export type CollectionTypes = IterableCollections | WeakCollections

type IterableCollections = Map<any, any> | Set<any>
type WeakCollections = WeakMap<any, any> | WeakSet<any>
type MapTypes = Map<any, any> | WeakMap<any, any>
type SetTypes = Set<any> | WeakSet<any>

// 转成响应式或者只读对象的方法
const toReactive = <T extends unknown>(value: T): T =>
  isObject(value) ? reactive(value) : value

const toReadonly = <T extends unknown>(value: T): T =>
  isObject(value) ? readonly(value) : value

// 通过Reflect获取原型对象
const getProto = <T extends CollectionTypes>(v: T): any =>
  Reflect.getPrototypeOf(v)

// get方法
function get(
  target: MapTypes,
  key: unknown,
  wrap: typeof toReactive | typeof toReadonly
) {
  // 这里的target是已经被proxy后的对象, 就是proxy的get trap里面的receiver, 而不是原始对象了
  // 取得对象的原始数据
  target = toRaw(target)
  // 由于Map可以用对象做key，所以key也有可能是个响应式数据，先转为原始数据
  key = toRaw(key)
  // 收集依赖
  track(target, OperationTypes.GET, key)
  // 获取target的原型对象上的get方法, 并且调用
  // 返回用包装方法(toReactive | toReadonly)处理处理完的对象(响应式的)
  return wrap(getProto(target).get.call(target, key))
}

function has(this: CollectionTypes, key: unknown): boolean {
  // 取得this和key的原值
  const target = toRaw(this)
  // toRaw(key)是因为key可以是Object|Array|WeakMap|WeakSet|Set|Map
  // 所以把key也要转成原对象
  key = toRaw(key)
  // 跟踪target的has操作, 依赖收集
  track(target, OperationTypes.HAS, key)
  return getProto(target).has.call(target, key)
}

function size(target: IterableCollections) {
  target = toRaw(target)
  track(target, OperationTypes.ITERATE)
  return Reflect.get(getProto(target), 'size', target)
}

function add(this: SetTypes, value: unknown) {
  value = toRaw(value)
  const target = toRaw(this)
  const proto = getProto(target)
  const hadKey = proto.has.call(target, value)
  const result = proto.add.call(target, value)
  if (!hadKey) {
    /* istanbul ignore else */
    if (__DEV__) {
      trigger(target, OperationTypes.ADD, value, { newValue: value })
    } else {
      trigger(target, OperationTypes.ADD, value)
    }
  }
  return result
}

function set(this: MapTypes, key: unknown, value: unknown) {
  // this是proxy以后的数据
  // 获取value的原值
  value = toRaw(value)
  // 获取this的原值
  const target = toRaw(this)
  // 获取原型对象
  const proto = getProto(target)
  // 判断target是否已经包含当前的key(区分增加和修改操作)
  const hadKey = proto.has.call(target, key)
  // 获取key的旧值
  const oldValue = proto.get.call(target, key)
  // 设置key的新值
  const result = proto.set.call(target, key, value)
  /* istanbul ignore else */
  if (__DEV__) {
    const extraInfo = { oldValue, newValue: value }
    if (!hadKey) {
      trigger(target, OperationTypes.ADD, key, extraInfo)
    } else if (hasChanged(value, oldValue)) {
      trigger(target, OperationTypes.SET, key, extraInfo)
    }
  } else {
    if (!hadKey) {
      trigger(target, OperationTypes.ADD, key)
    } else if (hasChanged(value, oldValue)) {
      trigger(target, OperationTypes.SET, key)
    }
  }
  return result
}

function deleteEntry(this: CollectionTypes, key: unknown) {
  const target = toRaw(this)
  const proto = getProto(target)
  const hadKey = proto.has.call(target, key)
  const oldValue = proto.get ? proto.get.call(target, key) : undefined
  // forward the operation before queueing reactions
  const result = proto.delete.call(target, key)
  if (hadKey) {
    /* istanbul ignore else */
    if (__DEV__) {
      trigger(target, OperationTypes.DELETE, key, { oldValue })
    } else {
      trigger(target, OperationTypes.DELETE, key)
    }
  }
  return result
}

function clear(this: IterableCollections) {
  const target = toRaw(this)
  const hadItems = target.size !== 0
  const oldTarget = __DEV__
    ? target instanceof Map
      ? new Map(target)
      : new Set(target)
    : undefined
  // forward the operation before queueing reactions
  const result = getProto(target).clear.call(target)
  if (hadItems) {
    /* istanbul ignore else */
    if (__DEV__) {
      trigger(target, OperationTypes.CLEAR, void 0, { oldTarget })
    } else {
      trigger(target, OperationTypes.CLEAR)
    }
  }
  return result
}

// 创建forEach方法
function createForEach(isReadonly: boolean) {
  return function forEach(
    this: IterableCollections,
    callback: Function,
    thisArg?: unknown
  ) {
    // this是proxy对象
    const observed = this
    // 获取原对象
    const target = toRaw(observed)
    // 根据isReadonly来确定包装方法
    const wrap = isReadonly ? toReadonly : toReactive
    // 依赖收集
    track(target, OperationTypes.ITERATE)
    // important: create sure the callback is
    // 1. invoked with the reactive map as `this` and 3rd arg
    // 2. the value received should be a corresponding reactive/readonly.
    // 增强传递进来的callback方法，让传入callback的数据，转为响应式数据
    function wrappedCallback(value: unknown, key: unknown) {
      return callback.call(observed, wrap(value), wrap(key), observed)
    }
    return getProto(target).forEach.call(target, wrappedCallback, thisArg)
  }
}

// 创建迭代器方法
function createIterableMethod(method: string | symbol, isReadonly: boolean) {
  return function(this: IterableCollections, ...args: unknown[]) {
    // 获取调用者的原值
    const target = toRaw(this)
    // isPair标识当前方法的返回值是否是成对的, 如entries就是返回的[key, value];
    // 如果方法是entries或者 (方法是Symbol.iterator且target是Map的实例)
    const isPair =
      method === 'entries' ||
      (method === Symbol.iterator && target instanceof Map)
    // 调用原来的迭代方法
    const innerIterator = getProto(target)[method].apply(target, args)
    // 确定包装方法
    const wrap = isReadonly ? toReadonly : toReactive
    // 依赖收集
    track(target, OperationTypes.ITERATE)
    // return a wrapped iterator which returns observed versions of the
    // values emitted from the real iterator
    // 返回一个包装过的iterator, 将其值转为响应式数据
    return {
      // iterator protocol
      next() {
        const { value, done } = innerIterator.next()
        // done为true(即迭代完毕的时候返回的值不需要转换成响应式对象)
        // 否则, 根据是否为isPair来返回对应的响应式对象
        return done
          ? { value, done }
          : {
              value: isPair ? [wrap(value[0]), wrap(value[1])] : wrap(value),
              done
            }
      },
      // iterable protocol
      [Symbol.iterator]() {
        return this
      }
    }
  }
}

function createReadonlyMethod(
  method: Function,
  type: OperationTypes
): Function {
  return function(this: CollectionTypes, ...args: unknown[]) {
    if (LOCKED) {
      if (__DEV__) {
        const key = args[0] ? `on key "${args[0]}" ` : ``
        console.warn(
          `${capitalize(type)} operation ${key}failed: target is readonly.`,
          toRaw(this)
        )
      }
      return type === OperationTypes.DELETE ? false : this
    } else {
      return method.apply(this, args)
    }
  }
}

const mutableInstrumentations: Record<string, Function> = {
  get(this: MapTypes, key: unknown) {
    return get(this, key, toReactive)
  },
  get size(this: IterableCollections) {
    return size(this)
  },
  has,
  add,
  set,
  delete: deleteEntry,
  clear,
  forEach: createForEach(false)
}

const readonlyInstrumentations: Record<string, Function> = {
  get(this: MapTypes, key: unknown) {
    // 这里的this是proxy后的对象, 是一个proxy
    return get(this, key, toReadonly)
  },
  get size(this: IterableCollections) {
    return size(this)
  },
  has,
  add: createReadonlyMethod(add, OperationTypes.ADD),
  set: createReadonlyMethod(set, OperationTypes.SET),
  delete: createReadonlyMethod(deleteEntry, OperationTypes.DELETE),
  clear: createReadonlyMethod(clear, OperationTypes.CLEAR),
  forEach: createForEach(true)
}

// 迭代器方法
const iteratorMethods = ['keys', 'values', 'entries', Symbol.iterator]
iteratorMethods.forEach(method => {
  mutableInstrumentations[method as string] = createIterableMethod(
    method,
    false
  )
  readonlyInstrumentations[method as string] = createIterableMethod(
    method,
    true
  )
})

// 创建getter函数
function createInstrumentationGetter(
  instrumentations: Record<string, Function>
) {
  // 返回一个处理后的get方法
  return (
    target: CollectionTypes,
    key: string | symbol,
    receiver: CollectionTypes
  ) =>
    // 如果instrumentations中有这个key, 且target中也有
    // 用instrumentations作为反射get的对象, 否则用target的
    // FIXME: 其实就是get, size, has, add, set, delete, clear, forEach采用mutableInstrumentations, readonlyInstrumentations对象上的
    // 而其他的采用target原始对象上的
    Reflect.get(
      hasOwn(instrumentations, key) && key in target
        ? instrumentations
        : target,
      key,
      receiver
    )
}

// 这里只劫持一个get trap是因为: 
// 如果直接劫持collections的set trap, 调用时会报 Uncaught TypeError: Method Set.prototype.add called on incompatible receiver [object Object]
// Reflect会通过this对target进行操作, Reflect中的this其实指向的是proxy而非原始的target
// 导致设置collections的设值操作失败, 这也是为什么collection需要特殊handlers的原因
// 详情可看: https://javascript.info/proxy#proxy-limitations
export const mutableCollectionHandlers: ProxyHandler<CollectionTypes> = {
  get: createInstrumentationGetter(mutableInstrumentations)
}

export const readonlyCollectionHandlers: ProxyHandler<CollectionTypes> = {
  get: createInstrumentationGetter(readonlyInstrumentations)
}
