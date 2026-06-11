/**
 * Sub-Store Script Operator
 * 功能：检测落地IP → 获取国家 → 重命名
 * 格式：🇺🇸 美国 01
 *
 * 参数（#后）：
 *   concurrency=3   并发
 *   timeout=8000    超时(ms)
 *   ttl=24          缓存小时
 */

const $ = $substore;

const CACHE_KEY = "rename_by_realip_v1";

function getFlagEmoji(cc) {
  if (!cc || cc.length !== 2) return "🏳️";
  return String.fromCodePoint(
    ...[...cc.toUpperCase()].map(c => 127397 + c.charCodeAt())
  );
}

// 国家中文映射（可自行补充）
const countryMap = {
  US: "美国",
  JP: "日本",
  HK: "香港",
  SG: "新加坡",
  TW: "台湾",
  KR: "韩国",
  GB: "英国",
  DE: "德国",
  FR: "法国",
  CA: "加拿大",
  AU: "澳大利亚",
};

async function operator(proxies = []) {
  const cache = $.cache.get(CACHE_KEY) || {};
  const now = Date.now();
  const ttl = ($arguments.ttl || 24) * 3600 * 1000;

  let indexMap = {}; // 每个国家计数

  await $.asyncMap(
    proxies,
    async (p) => {
      try {
        let key = p.server + ":" + p.port;
        let data = cache[key];

        // 缓存判断
        if (!data || now - data.time > ttl) {
          // 查询落地IP信息
          let res = await $.http.get({
            url: "http://ip-api.com/json",
            node: p,
            timeout: $arguments.timeout || 8000,
          });

          let json = JSON.parse(res.body || "{}");

          data = {
            cc: json.countryCode || "UN",
            time: now,
          };

          cache[key] = data;
        }

        let cc = data.cc || "UN";
        let countryName = countryMap[cc] || cc;

        // 序号
        if (!indexMap[cc]) indexMap[cc] = 1;
        let idx = String(indexMap[cc]++).padStart(2, "0");

        let flag = getFlagEmoji(cc);

        // 重命名
        p.name = `${flag} ${countryName} ${idx}`;

      } catch (e) {
        p.name = `🏳️ 未知 00`;
      }
    },
    { concurrency: $arguments.concurrency || 3 }
  );

  $.cache.set(CACHE_KEY, cache);

  return proxies;
}