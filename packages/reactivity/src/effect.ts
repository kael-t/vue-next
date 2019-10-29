import { OperationTypes } from './operations'
import { Dep, targetMap } from './reactive'
import { EMPTY_OBJ, extend } from '@vue/shared'

// 定义响应作用接口
export interface ReactiveEffect<T = any> {
  // 代表这是一个函数类型，不接受入参，返回结果类型为泛型T
  // T也即是原始函数的返回结果类型
  (): T
  // 是否为effect的标志
  _isEffect: true
  active: boolean
  // 监听函数的原始函数
  raw: () => T
  // 暂时未知，根据名字来看是存一些依赖
  // 根据类型来看，存放是二维集合数据，一维是数组，二维是ReactiveEffect的Set集合
  deps: Array<Dep>
  // 是否是computed数据依赖的监听函数
  computed?: boolean
  // 调度器函数，接受的入参run即是传给effect的函数，如果传了scheduler，则可通过其调用监听函数。
  scheduler?: (run: Function) => void
  // 调试用, 在依赖收集(getter)时会被调用
  onTrack?: (event: DebuggerEvent) => void
  // 调试用, 在触发更新(setter)时会被调用
  onTrigger?: (event: DebuggerEvent) => void
  //通过 `stop` 终止监听函数时触发的事件。
  onStop?: () => void
}

export interface ReactiveEffectOptions {
  // 是否延迟计算
  lazy?: boolean
  // 是否计算属性
  computed?: boolean
  // 调度器函数，接受的入参run即是传给effect的函数，如果传了scheduler，则可通过其调用监听函数。
  scheduler?: (run: Function) => void
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
  type: OperationTypes
  key: any
} & DebuggerEventExtraInfo

export interface DebuggerEventExtraInfo {
  newValue?: any
  oldValue?: any
  oldTarget?: Map<any, any> | Set<any>
}

export const effectStack: ReactiveEffect[] = []

// 迭代行为标识符
export const ITERATE_KEY = Symbol('iterate')

// 通过判断是否设置了_isEffect来判断当前的fn是否为一个effect
export function isEffect(fn: any): fn is ReactiveEffect {
  return fn != null && fn._isEffect === true
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
  // 如果没有设置lazy=false(不是惰性求值)的话, 直接调用一次
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
    if (effect.onStop) {
      effect.onStop()
    }
    // 把effect设置成不试用状态
    effect.active = false
  }
}

// 创建监听函数的方法
function createReactiveEffect<T = any>(
  fn: () => T,
  options: ReactiveEffectOptions
): ReactiveEffect<T> {
  // 创建监听函数，通过run来包裹原始函数，做额外操作
  const effect = function reactiveEffect(...args: unknown[]): unknown {
    return run(effect, fn, args)
  } as ReactiveEffect
  // 添加一系列的属性
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

// 监听函数的执行器
function run(effect: ReactiveEffect, fn: Function, args: unknown[]): unknown {
  // 如果监听函数不是active的, 执行监听的原始方法并返回结果
  if (!effect.active) {
    return fn(...args)
  }
  // 如果监听函数是active的且在监听函数栈内不存在相同的方法的话
  // 先清空监听函数, 防止递归调用造成循环
  if (!effectStack.includes(effect)) {
    cleanup(effect)
    try {
      // 把监听函数放进栈内, 且直接原始方法
      effectStack.push(effect)
      // 这里调用fn(effect的原始方法), 会触发原始方法里面引用的的变量的getter
      // 进而会进入到track(这里可以配合track函数看), 也就能给effect原始函数来收集依赖
      return fn(...args)
    } finally {
      // 无论是否报错都要把刚刚入栈的effect弹出
      effectStack.pop()
    }
  }
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
// 暂停跟踪
export function pauseTracking() {
  shouldTrack = false
}
// 重启跟踪
export function resumeTracking() {
  shouldTrack = true
}

export function track(target: object, type: OperationTypes, key?: unknown) {
  // 如果开关被关闭了, 或者监听函数中不存在元素, 不进行依赖收集
  if (!shouldTrack || effectStack.length === 0) {
    return
  }
  // 这里去最后一个是因为, 看run函数(执行器的逻辑), 会把target的依赖压到effectStack栈顶
  // 此时的栈顶(也就是数组的最后一个元素), 就正好是当前的effect原始函数, 此时就收集了函数内变量的依赖了
  const effect = effectStack[effectStack.length - 1]
  // 迭代操作重新设置一下key
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
  // 声明两个集合, 一个是普通的effects的, 一个是computed的
  const effects = new Set<ReactiveEffect>()
  const computedRunners = new Set<ReactiveEffect>()
  // 如果是清空操作的话, 需要触发所有的依赖
  // addRunners并未执行监听函数，而是将其推到一个执行队列中，待后续执行
  if (type === OperationTypes.CLEAR) {
    // collection being cleared, trigger all effects for target
    depsMap.forEach(dep => {
      addRunners(effects, computedRunners, dep)
    })
  } else {
    // schedule runs for SET | ADD | DELETE
    // key不为void 0，则说明肯定是SET | ADD | DELETE这三种操作
    // 然后将依赖这个key的所有监听函数推到相应队列中
    if (key !== void 0) {
      addRunners(effects, computedRunners, depsMap.get(key))
    }
    // also run for iteration key on ADD | DELETE
    // 如果是增加或者删除数据的行为，还要再往相应队列中增加监听函数
    // 这里对add和delete操作多做一次补充操作是因为, 像下面的代码
    // let arr = reactive<number[]>([])
    // arr.push(1)
    // 在执行上面if中的depsMap.get(key), 获取key=1的deps时, 其实取得的是undefined
    // 使得在addRunners函数中的effectsToAdd !==void 0 为false, 所以其实在上面的if中什么都没干
    // 在下面这里对上面做了补充操作, 在push时, 除了修改key, 其实还修改了数组的length, 在修改length的时候把effect
    // 加入到set中, 那就不会导致push操作什么都没修改到了
    // 但是像下面的代码中
    // let arr = reactive<number[]>([1,2,3,4,5])
    // delete arr[1]
    // depsMap.get(key)不为undefined, 所以添加了一次effect, 然后length也被修改了, 再添加了一次effect
    // 但是effect并不会被执行两次, 是因为无论是effects还是computedRunners, 都是Set类型
    // 也就是说相同的effect并不会被add到Set中两次, 所以就算执行了两次addRunners, 加到Set中的元素也只有1个
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
  // 运行计算属性的监听方法
  computedRunners.forEach(run)
  // 运行正常的监听方法
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
