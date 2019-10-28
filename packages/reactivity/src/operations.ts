// 枚举使用字符串而不使用数字是为了跟方便的去检查debugger事件
export const enum OperationTypes {
  // using literal strings instead of numbers so that it's easier to inspect
  // debugger events
  SET = 'set',
  ADD = 'add',
  DELETE = 'delete',
  CLEAR = 'clear',
  GET = 'get',
  HAS = 'has',
  ITERATE = 'iterate'
}
