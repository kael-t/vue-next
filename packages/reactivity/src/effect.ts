import { TrackOpTypes, TriggerOpTypes } from './operations'
import { EMPTY_OBJ, isArray } from '@vue/shared'

// The main WeakMap that stores {target -> key -> dep} connections.
// Conceptually, it's easier to think of a dependency as a Dep class
// which maintains a Set of subscribers, but we simply store them as
// raw Sets to reduce memory overhead.
/**
 * 把targetMap想想成一下结构
 * data: {
 *    a: [effect1, effec2, effect3],
 *    b: [effect3, effect4],
 *    c: [effect5],
 * }
 * 其中data就是targetMap(全局唯一, 并在vue运行时不断维护)
 * a/b/c都是KeyToDepMap保存的一个Set
 * a/b/c对应的数组就是Dep了, 保存的是一系列的effect
 * 假如b的effect4中依赖了c, 那么先从effect5开始, 触发了c的修改, 而c的修改触发了effect4的执行, 从而触发了b的修改
 * dep和effect是双向查询的
 * 可以通过keyToDepMap找到对应的dep对应的effect, 可以通过找到effect3
 * 也可以通过effect的deps属性找到对应的dep, 如effect3的deps就包含[a,b], 所以可以通过effect3的deps找到a
 */
// Dep存的是一系列的订阅者(也就是effect, 可以当做Dep放的就是effect方法)
type Dep = Set<ReactiveEffect>
// 存的是键和依赖Set的映射
type KeyToDepMap = Map<any, Dep>
// 主WeakMap, 存的是收集过依赖的键
const targetMap = new WeakMap<any, KeyToDepMap>()

// 定义响应作用接口
export interface ReactiveEffect<T = any> {
  // 代表这是一个函数类型，接受任意入参，返回结果类型为泛型T
  // T也即是原始函数的返回结果类型
  (...args: any[]): T
  // 是否为effect的标志
  _isEffect: true
  id: number
  active: boolean
  // 监听函数的原始函数
  raw: () => T
  // TODO: 暂时未知，根据名字来看是存一些依赖
  // 根据类型来看，存放是二维集合数据，一维是数组，二维是ReactiveEffect的Set集合
  deps: Array<Dep>
  options: ReactiveEffectOptions
}

export interface ReactiveEffectOptions {
  // 是否延迟计算
  lazy?: boolean
  // 是否计算属性
  computed?: boolean
  // 调度器函数，接受的入参run即是传给effect的函数，如果传了scheduler，则可通过其调用监听函数。
  // TODO: 这里改了入参. 再看看吧
  scheduler?: (job: ReactiveEffect) => void
  // 调试用, 在依赖收集(getter)时会被调用
  onTrack?: (event: DebuggerEvent) => void
  // 调试用, 在触发更新(setter)时会被调用
  onTrigger?: (event: DebuggerEvent) => void
  //通过 `stop` 终止监听函数时触发的事件。
  onStop?: () => void
}

export type DebuggerEvent = {
  effect: ReactiveEffect
  target: object
  type: TrackOpTypes | TriggerOpTypes
  key: any
} & DebuggerEventExtraInfo

export interface DebuggerEventExtraInfo {
  newValue?: any
  oldValue?: any
  oldTarget?: Map<any, any> | Set<any>
}

const effectStack: ReactiveEffect[] = []
let activeEffect: ReactiveEffect | undefined

// 迭代行为标识符
export const ITERATE_KEY = Symbol(__DEV__ ? 'iterate' : '')
export const MAP_KEY_ITERATE_KEY = Symbol(__DEV__ ? 'Map key iterate' : '')

// 通过判断是否设置了_isEffect来判断当前的fn是否为一个effect
export function isEffect(fn: any): fn is ReactiveEffect {
  return fn && fn._isEffect === true
}

// 生成监听函数的方法
export function effect<T = any>(
  // 原始方法
  fn: () => T,
  // 配置项
  options: ReactiveEffectOptions = EMPTY_OBJ
): ReactiveEffect<T> {
  // 判断是否已经是监听方法了, 是的话取fn.raw作为原始方法
  if (isEffect(fn)) {
    fn = fn.raw
  }
  // 创建监听函数
  const effect = createReactiveEffect(fn, options)
  /**
   * 如果没有设置lazy=false(不是惰性求值)的话, 直接调用一次, 所以
   * const fn = () => {};
   * effect(fn);
   * fn会直接被执行一次
   */
  if (!options.lazy) {
    effect()
  }
  // 返回监听方法
  return effect
}

/**
 * 停止对监听函数的监听, 也就是把监听函数的依赖表全部清除掉
 * 所以函数内的依赖变化不会再通知这个函数, 所以函数不会被调用了
 * @param effect 监听函数
 */
export function stop(effect: ReactiveEffect) {
  // 如果active为true，则触发effect.onStop，并且把active置为false。
  if (effect.active) {
    // 清空effect的依赖表
    cleanup(effect)
    // 如果提供了onStop回调,则调用(调试用)
    if (effect.options.onStop) {
      effect.options.onStop()
    }
    // 把effect设置成不使用状态
    effect.active = false
  }
}

let uid = 0

// 创建监听函数的方法
function createReactiveEffect<T = any>(
  fn: (...args: any[]) => T,
  options: ReactiveEffectOptions
): ReactiveEffect<T> {
  // 创建监听函数，通过run来包裹原始函数，做额外操作
  const effect = function reactiveEffect(...args: unknown[]): unknown {
    // 如果effect在不使用状态的话, 判断是否传了调度方法, 传了的话返回undefined, 没传的调用回调方法并返回结果
    if (!effect.active) {
      return options.scheduler ? undefined : fn(...args)
    }
    // 待执行effectStack中不包含当前
    if (!effectStack.includes(effect)) {
      cleanup(effect)
      try {
        enableTracking()
        effectStack.push(effect)
        activeEffect = effect
        return fn(...args)
      } finally {
        effectStack.pop()
        resetTracking()
        activeEffect = effectStack[effectStack.length - 1]
      }
    }
  } as ReactiveEffect
  // 添加一系列的属性
  effect.id = uid++
  effect._isEffect = true
  effect.active = true
  effect.raw = fn
  effect.deps = []
  effect.options = options
  return effect
}

// 传递一个监听函数, 把监听函数的依赖都清空
function cleanup(effect: ReactiveEffect) {
  const { deps } = effect
  // 清空依赖
  if (deps.length) {
    for (let i = 0; i < deps.length; i++) {
      deps[i].delete(effect)
    }
    deps.length = 0
  }
}

// 跟踪标志
let shouldTrack = true
const trackStack: boolean[] = []

// 暂停跟踪
export function pauseTracking() {
  trackStack.push(shouldTrack)
  shouldTrack = false
}

// TODO: 跟踪逻辑改了, 重新看看吧
export function enableTracking() {
  trackStack.push(shouldTrack)
  shouldTrack = true
}

export function resetTracking() {
  const last = trackStack.pop()
  shouldTrack = last === undefined ? true : last
}

export function track(target: object, type: TrackOpTypes, key: unknown) {
  if (!shouldTrack || activeEffect === undefined) {
    return
  }
  let depsMap = targetMap.get(target)
  if (!depsMap) {
    targetMap.set(target, (depsMap = new Map()))
  }
  let dep = depsMap.get(key)
  if (!dep) {
    depsMap.set(key, (dep = new Set()))
  }
  if (!dep.has(activeEffect)) {
    dep.add(activeEffect)
    activeEffect.deps.push(dep)
    if (__DEV__ && activeEffect.options.onTrack) {
      activeEffect.options.onTrack({
        effect: activeEffect,
        target,
        type,
        key
      })
    }
  }
}

// 触发数据更新
export function trigger(
  target: object,
  type: TriggerOpTypes,
  key?: unknown,
  newValue?: unknown,
  oldValue?: unknown,
  oldTarget?: Map<unknown, unknown> | Set<unknown>
) {
  // 获取依赖集, 通过target,在targetMap中获得depsMap, depsMap存的就是这个target的依赖了
  const depsMap = targetMap.get(target)
  if (!depsMap) {
    // never been tracked
    return
  }

  const effects = new Set<ReactiveEffect>()
  const computedRunners = new Set<ReactiveEffect>()
  // 把effect(回调方法)加入对应的队列中(普通effect队列和计算属性队列)
  const add = (effectsToAdd: Set<ReactiveEffect> | undefined) => {
    if (effectsToAdd) {
      effectsToAdd.forEach(effect => {
        // effect不是当前执行中的effect 或者 不需要跟踪的话
        if (effect !== activeEffect || !shouldTrack) {
          // 如果是计算属性则加到计算属性队列, 否则加入effects队列
          if (effect.options.computed) {
            computedRunners.add(effect)
          } else {
            effects.add(effect)
          }
        } else {
          // the effect mutated its own dependency during its execution.
          // this can be caused by operations like foo.value++
          // do not trigger or we end in an infinite loop
        }
      })
    }
  }

  if (type === TriggerOpTypes.CLEAR) {
    // collection being cleared
    // trigger all effects for target
    depsMap.forEach(add)
  } else if (key === 'length' && isArray(target)) {
    // 如果收集的依赖是数组的length的话
    depsMap.forEach((dep, key) => {
      // 判断依赖的是否是数组的length或者下标, 是的话把监听函数加到对应的队列中
      if (key === 'length' || key >= (newValue as number)) {
        add(dep)
      }
    })
  } else {
    // schedule runs for SET | ADD | DELETE
    // key不为void 0，则说明肯定是SET | ADD | DELETE这三种操作
    // 然后将依赖这个key的所有监听函数推到相应队列中
    if (key !== void 0) {
      add(depsMap.get(key))
    }
    // also run for iteration key on ADD | DELETE | Map.SET
    const isAddOrDelete =
      type === TriggerOpTypes.ADD ||
      (type === TriggerOpTypes.DELETE && !isArray(target))
    if (
      isAddOrDelete ||
      (type === TriggerOpTypes.SET && target instanceof Map)
    ) {
      add(depsMap.get(isArray(target) ? 'length' : ITERATE_KEY))
    }
    if (isAddOrDelete && target instanceof Map) {
      add(depsMap.get(MAP_KEY_ITERATE_KEY))
    }
  }

  const run = (effect: ReactiveEffect) => {
    if (__DEV__ && effect.options.onTrigger) {
      effect.options.onTrigger({
        effect,
        target,
        key,
        type,
        newValue,
        oldValue,
        oldTarget
      })
    }
    if (effect.options.scheduler) {
      effect.options.scheduler(effect)
    } else {
      effect()
    }
  }
  // Important: computed effects must be run first so that computed getters
  // can be invalidated before any normal effects that depend on them are run.
  // 运行计算属性的监听方法
  computedRunners.forEach(run)
  // 运行正常的监听方法
  effects.forEach(run)
}
