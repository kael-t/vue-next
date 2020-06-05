// using literal strings instead of numbers so that it's easier to inspect
// debugger events
// 枚举使用字符串而不使用数字是为了更方便的去检查debugger事件

export const enum TrackOpTypes {
  GET = 'get',
  HAS = 'has',
  ITERATE = 'iterate'
}

export const enum TriggerOpTypes {
  SET = 'set',
  ADD = 'add',
  DELETE = 'delete',
  CLEAR = 'clear'
}
