import { OperationTypes } from './operations'
import { Dep, targetMap } from './reactive'
import { EMPTY_OBJ, extend } from '@vue/shared'

// 定义响应作用接口
export interface ReactiveEffect<T = any> {
  (): T
  _isEffect: true
  active: boolean
  raw: () => T
  deps: Array<Dep>
  computed?: boolean
  scheduler?: (run: Function) => void
  onTrack?: (event: DebuggerEvent) => void
  onTrigger?: (event: DebuggerEvent) => void
  onStop?: () => void
}

export interface ReactiveEffectOptions {
  lazy?: boolean
  computed?: boolean
  scheduler?: (run: Function) => void
  onTrack?: (event: DebuggerEvent) => void
  onTrigger?: (event: DebuggerEvent) => void
  onStop?: () => void
}

export type DebuggerEvent = {
  effect: ReactiveEffect
  target: object
  type: OperationTypes
  key: any
} & DebuggerEventExtraInfo

export interface DebuggerEventExtraInfo {
  newValue?: any
  oldValue?: any
  oldTarget?: Map<any, any> | Set<any>
}

export const effectStack: ReactiveEffect[] = []

export const ITERATE_KEY = Symbol('iterate')

export function isEffect(fn: any): fn is ReactiveEffect {
  return fn != null && fn._isEffect === true
}

export function effect<T = any>(
  fn: () => T,
  options: ReactiveEffectOptions = EMPTY_OBJ
): ReactiveEffect<T> {
  if (isEffect(fn)) {
    fn = fn.raw
  }
  const effect = createReactiveEffect(fn, options)
  if (!options.lazy) {
    effect()
  }
  return effect
}

export function stop(effect: ReactiveEffect) {
  if (effect.active) {
    // 清空effect的依赖表
    cleanup(effect)
    // 如果提供了onStop回调,则调用(调试用)
    if (effect.onStop) {
      effect.onStop()
    }
    // 把effect设置成不试用状态
    effect.active = false
  }
}

function createReactiveEffect<T = any>(
  fn: () => T,
  options: ReactiveEffectOptions
): ReactiveEffect<T> {
  const effect = function reactiveEffect(...args: unknown[]): unknown {
    return run(effect, fn, args)
  } as ReactiveEffect
  effect._isEffect = true
  effect.active = true
  effect.raw = fn
  effect.scheduler = options.scheduler
  effect.onTrack = options.onTrack
  effect.onTrigger = options.onTrigger
  effect.onStop = options.onStop
  effect.computed = options.computed
  effect.deps = []
  return effect
}

function run(effect: ReactiveEffect, fn: Function, args: unknown[]): unknown {
  if (!effect.active) {
    return fn(...args)
  }
  if (!effectStack.includes(effect)) {
    cleanup(effect)
    try {
      effectStack.push(effect)
      return fn(...args)
    } finally {
      effectStack.pop()
    }
  }
}

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
// 暂停跟踪
export function pauseTracking() {
  shouldTrack = false
}
// 重启跟踪
export function resumeTracking() {
  shouldTrack = true
}

export function track(target: object, type: OperationTypes, key?: unknown) {
  // 如果开关被关闭了, 不进行依赖收集
  if (!shouldTrack || effectStack.length === 0) {
    return
  }
  // TODO: 为什么要取最后一个??? 触发get???? 应该不是吧?? effectStack应该并不是一个reactive对象
  const effect = effectStack[effectStack.length - 1]
  if (type === OperationTypes.ITERATE) {
    key = ITERATE_KEY
  }
  // 从targetMap中获取这个target对应的依赖
  let depsMap = targetMap.get(target)
  // 如果depsMap不存在, 就是还没有其他的变量或者视图依赖这个target的话
  // 就为target新建一个depsMap, 并保存到targetMap中
  if (depsMap === void 0) {
    targetMap.set(target, (depsMap = new Map()))
  }
  // 感叹号是非空断言, 标识key必定存在
  let dep = depsMap.get(key!)
  // 如果依赖不存在的话, 就新建依赖的Set, 并为key设置对应的依赖
  if (dep === void 0) {
    depsMap.set(key!, (dep = new Set()))
  }
  // 如果effect不在依赖表中, 则添加
  // 并在effect的deps数组中加入当前的依赖
  if (!dep.has(effect)) {
    dep.add(effect)
    effect.deps.push(dep)
    // 在__DEV__下且effect.onTrack存在时, 调用该effect.onTrack方法, 方便调试使用
    if (__DEV__ && effect.onTrack) {
      effect.onTrack({
        effect,
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
  type: OperationTypes,
  key?: unknown,
  extraInfo?: DebuggerEventExtraInfo
) {
  // 获取依赖集, 通过target,在targetMap中获得depsMap, depsMap存的就是这个target的依赖了
  const depsMap = targetMap.get(target)
  // 如果depsMap未定义, 说明这个target没有被track, 没被track depsMap就会未定义(因为track后必然会new Map())
  if (depsMap === void 0) {
    // never been tracked
    return
  }
  const effects = new Set<ReactiveEffect>()
  const computedRunners = new Set<ReactiveEffect>()
  // 如果是清空操作的话, 需要触发所有的依赖
  if (type === OperationTypes.CLEAR) {
    // collection being cleared, trigger all effects for target
    depsMap.forEach(dep => {
      addRunners(effects, computedRunners, dep)
    })
  } else {
    // schedule runs for SET | ADD | DELETE
    if (key !== void 0) {
      addRunners(effects, computedRunners, depsMap.get(key))
    }
    // also run for iteration key on ADD | DELETE
    if (type === OperationTypes.ADD || type === OperationTypes.DELETE) {
      const iterationKey = Array.isArray(target) ? 'length' : ITERATE_KEY
      addRunners(effects, computedRunners, depsMap.get(iterationKey))
    }
  }
  const run = (effect: ReactiveEffect) => {
    scheduleRun(effect, target, type, key, extraInfo)
  }
  // FIXME: 这里的前后顺序很关键, why???
  // Important: computed effects must be run first so that computed getters
  // can be invalidated before any normal effects that depend on them are run.
  computedRunners.forEach(run)
  effects.forEach(run)
}

// 把依赖(effectsToAdd)加入到运行队列(effects | computedRunners)中
function addRunners(
  effects: Set<ReactiveEffect>,
  computedRunners: Set<ReactiveEffect>,
  effectsToAdd: Set<ReactiveEffect> | undefined
) {
  // 如果effectsToAdd存在才加
  if (effectsToAdd !== void 0) {
    // 遍历, 如果effect.computed是true的话, 也就是当前的响应式对象是computed的
    // 就加入computed队列, 否则加入正常队列
    effectsToAdd.forEach(effect => {
      if (effect.computed) {
        computedRunners.add(effect)
      } else {
        effects.add(effect)
      }
    })
  }
}

// 任务调度，就理解为data更新之后，调用effect.scheduler去更新dom
function scheduleRun(
  effect: ReactiveEffect,
  target: object,
  type: OperationTypes,
  key: unknown,
  extraInfo?: DebuggerEventExtraInfo
) {
  if (__DEV__ && effect.onTrigger) {
    const event: DebuggerEvent = {
      effect,
      target,
      key,
      type
    }
    effect.onTrigger(extraInfo ? extend(event, extraInfo) : event)
  }
  // 如果调度函数存在, 就传入响应式对象调用调度函数
  // 否则直接调用effect
  if (effect.scheduler !== void 0) {
    effect.scheduler(effect)
  } else {
    effect()
  }
}
