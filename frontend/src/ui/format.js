// 数值显示格式化 —— 字典 JSON 存游戏内部单位,单位换算只在这一个文件做。
// 换算规则(对照游戏文件与 wiki 双重验证):
//   帧 → 秒:÷60(火花弹 castDelay=3 → 显示 +0.05 s)
//   伤害内部值 → 显示值:×25(light_bullet.xml damage=0.12 → 游戏显示 3)
// 其余(散射角度、暴击百分点、速度、爆炸半径像素)原值直出。

/** 数字 → 字符串:最多 2 位小数,去掉尾随零(0.050 → '0.05',3.00 → '3')。 */
export function trimNum(n) {
  return String(Math.round(n * 100) / 100)
}

/** 帧数 → 秒(字符串,不带单位)。 */
export function frames2s(frames) {
  return trimNum(frames / 60)
}

/** 帧数增量 → 带符号的秒串:'+0.05 s' / '-0.42 s'。 */
export function signedFrames2s(frames) {
  return `${frames >= 0 ? '+' : ''}${frames2s(frames)} s`
}

/** 伤害内部值 → 游戏显示值(×25)。 */
export function dmg(internal) {
  return trimNum(internal * 25)
}

/** 带符号数值:signedNum(5, ' %') → '+5 %';负数自带负号。 */
export function signedNum(n, suffix = '') {
  return `${n >= 0 ? '+' : ''}${trimNum(n)}${suffix}`
}

/** 速度区间:'750~850';上下限相同时只出一个数。 */
export function speedRange(min, max) {
  return min === max ? trimNum(min) : `${trimNum(min)}~${trimNum(max)}`
}
