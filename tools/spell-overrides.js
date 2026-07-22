// 法术数值手工覆盖表 —— build-dict.js 正则启发式解析不了的少数复杂 action()
// 函数体,在此按 id 给出人工核对的最终值(对照 gun_actions.lua 源码 + wiki)。
//
// 合并语义:浅合并覆盖到解析结果之上;值为 null 表示删除该字段(用于清掉
// 误解析出的值)。damageMods 为整体替换(不做深合并)。
// 覆盖后该法术的 statsApprox 标记会被清除(视为已人工核实)。
//
// 维护流程:每次重跑 build-dict.js 后,查看日志里的「近似值法术」清单,
// 对照源码/wiki 把确认值补进来,再重跑一次。
// 刻意不覆盖(保持 statsApprox,数值取决于施法时状态):
//   MONEY_MAGIC(按持有金钱)、BLOOD_TO_POWER(按当前血量)、
//   DAMAGE_RANDOM(随机)、DAMAGE_FOREVER(按剩余法力)。

export const SPELL_STAT_OVERRIDES = {
  // 挖掘/材料喷射族:current_reload_time -= ACTION_DRAW_RELOAD_TIME_INCREASE + 10
  // (减回抽牌隐含的充能增量再 -10,净效果 = 充能 -10 帧;与 wiki 一致)
  DIGGER: { rechargeTime: -10 },
  POWERDIGGER: { rechargeTime: -10 },
  CHAINSAW: { rechargeTime: -10 },
  LUMINOUS_DRILL: { rechargeTime: -10 },
  LASER_LUMINOUS_DRILL: { rechargeTime: -10 },
  MATERIAL_WATER: { rechargeTime: -10 },
  MATERIAL_OIL: { rechargeTime: -10 },
  MATERIAL_BLOOD: { rechargeTime: -10 },
  MATERIAL_ACID: { rechargeTime: -10 },
  MATERIAL_CEMENT: { rechargeTime: -10 },
  // 巨型黑洞/白洞:增量在"场上同类少于 3 个"的守卫内,常态下生效
  BLACK_HOLE_GIGA: { castDelay: 120, rechargeTime: 100 },
  WHITE_HOLE_GIGA: { castDelay: 120, rechargeTime: 100 },
  // 绝对赋值(c.fire_rate_wait = N / current_reload_time = N),按目标值记
  NUKE: { castDelay: 20 },
  NUKE_GIGA: { castDelay: 50 },
  SLOW_BUT_STEADY: { rechargeTime: 90 },
  // 复制/汇集族:函数体后段对 firerate/reload 的赋值是"调用子法术后的恢复
  // 现场",顶部增量才是本法术的真实修正
  DUPLICATE: { castDelay: 20, rechargeTime: 20 },
  MU: { castDelay: 50 },
  PHI: { castDelay: 50 },
  SIGMA: { castDelay: 30 },
  DIVIDE_2: { castDelay: 20 },
  DIVIDE_3: { castDelay: 35 },
  DIVIDE_4: { castDelay: 50 },
  DIVIDE_10: { castDelay: 80, rechargeTime: 20 },
  // 弹跳清零(c.bounces = 0)是法术本体行为,desc 已说明;仅清除近似标记
  REMOVE_BOUNCE: {},
  // 伤害归零:增量部分(施法延迟/存在时间)解析正确,归零语义由描述表达
  ZERO_DAMAGE: { castDelay: -5, lifetimeAdd: 280 },
};
