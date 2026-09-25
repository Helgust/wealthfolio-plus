// Фаза 0: черновой движок для замера скорости в песочнице аддона.
// Не модель — только нагрузка, похожая на будущий годовой цикл: генерация доходностей,
// прогрессивная шкала по двум половинам, база сбережений, поиск tramo RETA.
// Числа шкал — условные, для нагрузки; настоящие правила появятся в фазе 1 из plus/python/rules.

interface Bracket {
  upTo: number;
  rate: number;
}

const GENERAL_HALF: Bracket[] = [
  { upTo: 12_450, rate: 0.095 },
  { upTo: 20_200, rate: 0.12 },
  { upTo: 35_200, rate: 0.15 },
  { upTo: 60_000, rate: 0.185 },
  { upTo: 300_000, rate: 0.225 },
  { upTo: Infinity, rate: 0.245 },
];

const AHORRO: Bracket[] = [
  { upTo: 6_000, rate: 0.19 },
  { upTo: 50_000, rate: 0.21 },
  { upTo: 200_000, rate: 0.23 },
  { upTo: 300_000, rate: 0.27 },
  { upTo: Infinity, rate: 0.3 },
];

const RETA_TRAMOS = Array.from({ length: 15 }, (_, i) => ({
  upTo: 670 + i * 450,
  cuota: 200 + i * 40,
}));

function scale(base: number, brackets: Bracket[]): number {
  let tax = 0;
  let lower = 0;
  for (const b of brackets) {
    if (base <= lower) break;
    tax += (Math.min(base, b.upTo) - lower) * b.rate;
    lower = b.upTo;
  }
  return tax;
}

function retaCuota(monthly: number): number {
  for (const t of RETA_TRAMOS) if (monthly <= t.upTo) return t.cuota * 12;
  return RETA_TRAMOS[RETA_TRAMOS.length - 1].cuota * 12;
}

// mulberry32 — детерминированный генератор, чтобы прогоны были воспроизводимы.
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export interface BenchResult {
  trials: number;
  years: number;
  ms: number;
  medianFinal: number;
  successRate: number;
}

export function runBench(trials = 1_000, years = 40, seed = 42): BenchResult {
  const t0 = performance.now();
  const next = rng(seed);
  const gauss = () => Math.sqrt(-2 * Math.log(next() || 1e-12)) * Math.cos(2 * Math.PI * next());

  const cash = new Float64Array(trials).fill(30_000);
  const funds = new Float64Array(trials).fill(100_000);
  const income = new Float64Array(trials).fill(60_000);
  const spending = new Float64Array(trials).fill(35_000);
  const alive = new Uint8Array(trials).fill(1);

  for (let y = 0; y < years; y++) {
    const working = y < 25;
    for (let i = 0; i < trials; i++) {
      if (!alive[i]) continue;
      const inflation = 0.02 + 0.01 * gauss();
      const equity = Math.exp(0.05 + 0.16 * gauss()) - 1;

      const gross = working ? income[i] : 0;
      const reta = working ? retaCuota((gross * 0.93) / 12) : 0;
      const neto = Math.max(0, gross - reta);
      const irpfGeneral = 2 * scale(neto, GENERAL_HALF) - 2 * scale(5_550, GENERAL_HALF);

      const gain = funds[i] * equity;
      funds[i] += gain;
      const need = spending[i] - (neto - irpfGeneral);
      if (need > 0) {
        const fromCash = Math.min(cash[i], need);
        cash[i] -= fromCash;
        const sale = need - fromCash;
        const realized = sale * 0.4;
        funds[i] -= sale + scale(Math.max(0, realized), AHORRO);
      } else {
        cash[i] -= need;
      }
      if (cash[i] + funds[i] <= 0) alive[i] = 0;

      income[i] *= 1 + inflation;
      spending[i] *= 1 + inflation;
    }
  }

  const finals = Float64Array.from(cash, (c, i) => c + funds[i]).sort();
  let ok = 0;
  for (let i = 0; i < trials; i++) ok += alive[i];
  return {
    trials,
    years,
    ms: performance.now() - t0,
    medianFinal: finals[Math.floor(trials / 2)],
    successRate: ok / trials,
  };
}
