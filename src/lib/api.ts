/**
 * Tauri komut wrapper'ı. Tek tip invoke + tip güvenli sonuçlar.
 * Faz 4'te domain hooks (usePortfolios, useAssets...) bunun üstüne kurulacak.
 */
import { invoke } from "@tauri-apps/api/core";

export type HealthInfo = {
  schema_version: number;
  portfolios: number;
  settings: number;
};

export type Profile = {
  id: number;
  name: string;
  pinned: number;
  created_at: number;
};

export type Portfolio = {
  id: number;
  name: string;
  created_at: number;
  pinned: number;
  profile_id: number;
};

export type Budget = {
  id: number;
  name: string;
  monthly_income: number;
  monthly_expense: number;
  /** Varsayılan entry currency */
  currency: string;
  target_value: number | null;
  target_date: number | null;
  pinned: number;
  created_at: number;
  profile_id: number | null;
  /** Hedef değerin currency'si — entry currency'sinden ayrı olabilir */
  target_currency: string | null;
};

export type InvestmentEntry = {
  profile_id: number;
  year_month: string;
  currency: string;
  amount: number;
  fx_to_usd: number | null;
  note: string | null;
  recorded_at: number;
};

export type BudgetEntry = {
  budget_id: number;
  year_month: string;
  income: number;
  expense: number;
  note: string | null;
  recorded_at: number;
  /** Bu entry'nin native currency'si. NULL = eski kayıt, bütçe currency'si varsayılır */
  currency: string | null;
  /** 1 native = X USD, entry tarihindeki kilit. NULL = current FX fallback */
  fx_to_usd: number | null;
};

export type BudgetProjection = {
  budget_id: number;
  currency: string;
  monthly_savings: number;
  current_portfolio_value: number;
  monthly_passive_income: number;
  months_to_target: number | null;
  trajectory: [number, number][];
};

export type Asset = {
  id: number;
  portfolio_id: number;
  symbol: string;
  name: string;
  type: "crypto" | "stock" | "fx" | "commodity";
  currency: string;
  external_id: string | null;
  created_at: number;
  expected_yield_pct: number | null;
  icon_url: string | null;
  /** Opsiyonel: varlığın bulunduğu platform/borsa (örn "Binance") */
  platform: string | null;
};

export type Transaction = {
  id: number;
  asset_id: number;
  date: number;
  type: "buy" | "sell" | "passive_income";
  source: "staking" | "dividend" | "interest" | null;
  quantity: number;
  price: number;
  fee: number;
  note: string | null;
  is_deleted: number;
  created_at: number;
  /** 1 asset.currency = X USD, transaction.date günkü kilit. NULL = current FX fallback */
  fx_to_usd: number | null;
  /** Opsiyonel: işlemin yapıldığı platform/borsa */
  platform: string | null;
};

export type CryptoPrice = {
  id: string;
  usd: number;
  try_: number;
  eur: number;
};

export type StockPrice = {
  symbol: string;
  price: number;
  currency: string;
};

export type FxRates = {
  fetched_at: number;
  rates: Record<string, number>;
};

export type PriceResult = {
  price: number;
  currency: string;
  source: string;
  cache_hit: boolean;
  fetched_at: number;
};

export type SaleValidation = {
  asset_id: number;
  current_balance: number;
  attempted_quantity: number;
  is_sufficient: boolean;
  suggested_max: number;
  shortage: number;
};

export type AssetStats = {
  asset_id: number;
  symbol: string;
  name: string;
  asset_type: string;
  asset_currency: string;
  icon_url: string | null;
  expected_yield_pct: number | null;
  platform: string | null;
  /** Transactions'tan derive edilen distinct platform listesi. 1+ olduğunda
   *  Çeşitli göstergesi UI'da kullanılır. */
  platforms: string[];
  balance: number;
  avg_cost: number;
  current_price: number | null;
  price_currency: string | null;
  price_fetched_at: number | null;
  price_change_24h_pct: number | null;
  market_value_display: number | null;
  total_cost_display: number;
  unrealized_pl_display: number | null;
  realized_pl_native: number;
};

export type PortfolioStats = {
  portfolio_id: number;
  display_currency: string;
  total_value: number;
  total_cost: number;
  total_unrealized_pl: number;
  total_change_24h: number | null;
  total_change_24h_pct: number | null;
  assets: AssetStats[];
  assets_missing_price: number;
};

export type PassiveIncomeBreakdown = {
  staking: number;
  dividend: number;
  interest: number;
  total: number;
};

export type PassiveIncomeStats = {
  portfolio_id: number | null;
  display_currency: string;
  period: string;
  from_ts: number | null;
  breakdown: PassiveIncomeBreakdown;
  /** [yyyy-mm, total] */
  monthly: [string, number][];
  records_count: number;
};

export type ChartRange = "1d" | "1w" | "1m" | "3m" | "1y" | "max";

export type AssetHistory = {
  asset_id: number;
  range: string;
  /** [timestamp_ms, price_in_asset_currency] */
  points: [number, number][];
  source: string;
  cache_hit: boolean;
  fetched_at: number;
};

export type PortfolioHistoryPoint = {
  ts: number;
  value: number;
  /** true = hipotetik (bugünkü bakiye × o günkü fiyat). false = gerçek snapshot. */
  is_hypothetical: boolean;
};

export type PortfolioHistory = {
  portfolio_id: number | null;
  range: string;
  display_currency: string;
  points: PortfolioHistoryPoint[];
  samples: number;
};

export type HomeSummary = {
  display_currency: string;
  total_value: number;
  total_invested: number;
  total_unrealized_pl: number;
  cagr_pct: number | null;
  monthly_investment_avg: number | null;
  passive_income_annual: number;
  target_value: number | null;
  target_progress_pct: number | null;
  budget_id: number | null;
};

export type PriceAlert = {
  id: number;
  asset_id: number;
  condition: "above" | "below";
  threshold: number;
  currency: string;
  active: number;
  triggered_at: number | null;
  created_at: number;
};

export type TriggeredAlert = {
  alert_id: number;
  asset_symbol: string;
  asset_name: string;
  condition: string;
  threshold: number;
  current_price: number;
  currency: string;
};

export type Goal = {
  id: number;
  name: string;
  target_value: number;
  currency: string;
  target_date: number | null;
  achieved_at: number | null;
  created_at: number;
};

export type GoalCheckResult = {
  goal_id: number;
  achieved: boolean;
  current_value: number;
  target_value: number;
  progress: number;
};

export const api = {
  health: () => invoke<HealthInfo>("db_health_check"),

  // Profile
  createProfile: (name: string) => invoke<Profile>("create_profile", { name }),
  listProfiles: () => invoke<Profile[]>("list_profiles"),
  renameProfile: (id: number, name: string) =>
    invoke<void>("rename_profile", { id, name }),
  deleteProfile: (id: number) => invoke<void>("delete_profile", { id }),
  setProfilePin: (id: number, pinned: boolean) =>
    invoke<void>("set_profile_pin", { id, pinned }),

  // Portfolio
  createPortfolio: (name: string, profileId: number) =>
    invoke<Portfolio>("create_portfolio", { name, profileId }),
  listPortfolios: (profileId: number | null = null) =>
    invoke<Portfolio[]>("list_portfolios", { profileId }),
  deletePortfolio: (id: number) => invoke<void>("delete_portfolio", { id }),
  setPortfolioPin: (id: number, pinned: boolean) =>
    invoke<void>("set_portfolio_pin", { id, pinned }),
  renamePortfolio: (id: number, name: string) =>
    invoke<void>("rename_portfolio", { id, name }),

  // Budget
  createBudget: (args: {
    profileId: number;
    name: string;
    monthlyIncome: number;
    monthlyExpense: number;
    currency: string;
    targetValue: number | null;
    targetDate: number | null;
    targetCurrency?: string | null;
  }) =>
    invoke<Budget>("create_budget", {
      profileId: args.profileId,
      name: args.name,
      monthlyIncome: args.monthlyIncome,
      monthlyExpense: args.monthlyExpense,
      currency: args.currency,
      targetValue: args.targetValue,
      targetDate: args.targetDate,
      targetCurrency: args.targetCurrency ?? null,
    }),
  listBudgets: (profileId: number | null = null) =>
    invoke<Budget[]>("list_budgets", { profileId }),
  updateBudget: (args: {
    id: number;
    name: string;
    monthlyIncome: number;
    monthlyExpense: number;
    currency: string;
    targetValue: number | null;
    targetDate: number | null;
    targetCurrency?: string | null;
  }) =>
    invoke<Budget>("update_budget", {
      id: args.id,
      name: args.name,
      monthlyIncome: args.monthlyIncome,
      monthlyExpense: args.monthlyExpense,
      currency: args.currency,
      targetValue: args.targetValue,
      targetDate: args.targetDate,
      targetCurrency: args.targetCurrency ?? null,
    }),
  deleteBudget: (id: number) => invoke<void>("delete_budget", { id }),
  setBudgetPin: (id: number, pinned: boolean) =>
    invoke<void>("set_budget_pin", { id, pinned }),
  upsertBudgetEntry: (args: {
    budgetId: number;
    yearMonth: string;
    income: number;
    expense: number;
    note: string | null;
    currency?: string | null;
  }) =>
    invoke<BudgetEntry>("upsert_budget_entry", {
      budgetId: args.budgetId,
      yearMonth: args.yearMonth,
      income: args.income,
      expense: args.expense,
      note: args.note,
      currency: args.currency ?? null,
    }),
  listBudgetEntries: (budgetId: number) =>
    invoke<BudgetEntry[]>("list_budget_entries", { budgetId }),
  deleteBudgetEntry: (budgetId: number, yearMonth: string) =>
    invoke<void>("delete_budget_entry", { budgetId, yearMonth }),
  projectBudget: (budgetId: number) =>
    invoke<BudgetProjection>("project_budget", { budgetId }),

  // Investment entries (bütçeden bağımsız aylık yatırım/birikim)
  upsertInvestmentEntry: (args: {
    profileId: number;
    yearMonth: string;
    currency: string;
    amount: number;
    note: string | null;
  }) =>
    invoke<InvestmentEntry>("upsert_investment_entry", {
      profileId: args.profileId,
      yearMonth: args.yearMonth,
      currency: args.currency,
      amount: args.amount,
      note: args.note,
    }),
  listInvestmentEntries: (profileId: number) =>
    invoke<InvestmentEntry[]>("list_investment_entries", { profileId }),
  deleteInvestmentEntry: (
    profileId: number,
    yearMonth: string,
    currency: string
  ) =>
    invoke<void>("delete_investment_entry", { profileId, yearMonth, currency }),

  // Asset
  createAsset: (args: {
    portfolioId: number;
    symbol: string;
    name: string;
    type: Asset["type"];
    currency: string;
    externalId: string | null;
    iconUrl?: string | null;
    expectedYieldPct?: number | null;
    platform?: string | null;
  }) =>
    invoke<Asset>("create_asset", {
      portfolioId: args.portfolioId,
      symbol: args.symbol,
      name: args.name,
      type: args.type,
      currency: args.currency,
      externalId: args.externalId,
      iconUrl: args.iconUrl ?? null,
      expectedYieldPct: args.expectedYieldPct ?? null,
      platform: args.platform ?? null,
    }),
  findOrCreateAsset: (args: {
    portfolioId: number;
    symbol: string;
    name: string;
    type: Asset["type"];
    currency: string;
    externalId: string | null;
    iconUrl?: string | null;
    expectedYieldPct?: number | null;
    platform?: string | null;
  }) =>
    invoke<Asset>("find_or_create_asset", {
      portfolioId: args.portfolioId,
      symbol: args.symbol,
      name: args.name,
      type: args.type,
      currency: args.currency,
      externalId: args.externalId,
      iconUrl: args.iconUrl ?? null,
      expectedYieldPct: args.expectedYieldPct ?? null,
      platform: args.platform ?? null,
    }),
  listAssets: (portfolioId: number) =>
    invoke<Asset[]>("list_assets", { portfolioId }),
  deleteAsset: (id: number) => invoke<void>("delete_asset", { id }),
  updateAssetPlatform: (id: number, platform: string | null) =>
    invoke<void>("update_asset_platform", { id, platform }),
  updateAssetYield: (id: number, expectedYieldPct: number | null) =>
    invoke<void>("update_asset_yield", { id, expectedYieldPct }),

  // Transaction
  createTransaction: (args: {
    assetId: number;
    date: number;
    type: Transaction["type"];
    source?: Transaction["source"];
    quantity: number;
    price: number;
    fee?: number;
    note?: string | null;
    tags?: string[] | null;
    platform?: string | null;
  }) =>
    invoke<Transaction>("create_transaction", {
      assetId: args.assetId,
      date: args.date,
      type: args.type,
      source: args.source ?? null,
      quantity: args.quantity,
      price: args.price,
      fee: args.fee ?? null,
      note: args.note ?? null,
      tags: args.tags ?? null,
      platform: args.platform ?? null,
    }),
  listTransactions: (
    assetId: number,
    includeDeleted = false,
    tag: string | null = null
  ) =>
    invoke<Transaction[]>("list_transactions", {
      assetId,
      includeDeleted,
      tag,
    }),
  listTransactionTags: (assetId: number) =>
    invoke<string[]>("list_transaction_tags", { assetId }),
  listTagsOfTransaction: (transactionId: number) =>
    invoke<string[]>("list_tags_of_transaction", { transactionId }),
  updateTransaction: (args: {
    id: number;
    date: number;
    quantity: number;
    price: number;
    fee?: number;
    note?: string | null;
    tags?: string[] | null;
    platform?: string | null;
  }) =>
    invoke<Transaction>("update_transaction", {
      id: args.id,
      date: args.date,
      quantity: args.quantity,
      price: args.price,
      fee: args.fee ?? null,
      note: args.note ?? null,
      tags: args.tags ?? null,
      platform: args.platform ?? null,
    }),
  softDeleteTransaction: (id: number) =>
    invoke<void>("soft_delete_transaction", { id }),
  hardDeleteTransaction: (id: number) =>
    invoke<void>("hard_delete_transaction", { id }),
  restoreTransaction: (id: number) =>
    invoke<void>("restore_transaction", { id }),

  // Price
  fetchCryptoPrice: (coingeckoId: string) =>
    invoke<CryptoPrice>("fetch_crypto_price", { coingeckoId }),
  fetchStockPriceYahoo: (symbol: string) =>
    invoke<StockPrice>("fetch_stock_price_yahoo", { symbol }),
  fetchFxRates: () => invoke<FxRates>("fetch_fx_rates"),
  getCachedPrice: (assetId: number) =>
    invoke<{ asset_id: number; price: number; currency: string; fetched_at: number } | null>(
      "get_cached_price",
      { assetId }
    ),
  refreshAllPrices: (portfolioId: number, force = false) =>
    invoke<Record<number, PriceResult>>("refresh_all_prices", {
      portfolioId,
      force,
    }),

  // Search
  searchSymbol: (query: string, assetType: Asset["type"]) =>
    invoke<
      {
        external_id: string;
        symbol: string;
        name: string;
        icon: string | null;
        asset_type: string;
        exchange: string | null;
      }[]
    >("search_symbol", { query, assetType }),

  // Calc
  validateSale: (assetId: number, quantity: number) =>
    invoke<SaleValidation>("validate_sale", { assetId, quantity }),
  calculatePortfolio: (portfolioId: number, displayCurrency: string) =>
    invoke<PortfolioStats>("calculate_portfolio", {
      portfolioId,
      displayCurrency,
    }),
  calculatePassiveIncome: (
    portfolioId: number | null,
    displayCurrency: string,
    period: string
  ) =>
    invoke<PassiveIncomeStats>("calculate_passive_income", {
      portfolioId,
      displayCurrency,
      period,
    }),
  homeSummary: (profileId: number, displayCurrency: string) =>
    invoke<HomeSummary>("home_summary", { profileId, displayCurrency }),
  fetchAssetHistory: (assetId: number, range: ChartRange) =>
    invoke<AssetHistory>("fetch_asset_history", { assetId, range }),
  fetchPortfolioHistory: (
    portfolioId: number | null,
    range: ChartRange,
    displayCurrency: string
  ) =>
    invoke<PortfolioHistory>("fetch_portfolio_history", {
      portfolioId,
      range,
      displayCurrency,
    }),

  // Alerts
  createAlert: (args: {
    assetId: number;
    condition: "above" | "below";
    threshold: number;
    currency: string;
  }) =>
    invoke<PriceAlert>("create_alert", {
      assetId: args.assetId,
      condition: args.condition,
      threshold: args.threshold,
      currency: args.currency,
    }),
  listAlerts: (portfolioId: number | null = null, onlyActive = false) =>
    invoke<PriceAlert[]>("list_alerts", { portfolioId, onlyActive }),
  updateAlert: (args: {
    id: number;
    condition: "above" | "below";
    threshold: number;
    currency: string;
    active?: boolean;
  }) =>
    invoke<PriceAlert>("update_alert", {
      id: args.id,
      condition: args.condition,
      threshold: args.threshold,
      currency: args.currency,
      active: args.active ?? null,
    }),
  deleteAlert: (id: number) => invoke<void>("delete_alert", { id }),
  checkAlerts: () => invoke<TriggeredAlert[]>("check_alerts"),

  // Goals
  createGoal: (args: {
    name: string;
    targetValue: number;
    currency: string;
    targetDate: number | null;
  }) =>
    invoke<Goal>("create_goal", {
      name: args.name,
      targetValue: args.targetValue,
      currency: args.currency,
      targetDate: args.targetDate,
    }),
  listGoals: () => invoke<Goal[]>("list_goals"),
  checkGoalAchievement: (goalId: number, currentValue: number) =>
    invoke<GoalCheckResult>("check_goal_achievement", {
      goalId,
      currentValue,
    }),
  estimateGoalPace: (args: {
    portfolioId: number | null;
    currency: string;
    targetValue: number;
    currentValue: number;
    days?: number;
  }) =>
    invoke<{
      avg_daily_growth: number;
      days_to_goal: number | null;
      days_window: number;
      samples: number;
    }>("estimate_goal_pace", {
      portfolioId: args.portfolioId,
      currency: args.currency,
      targetValue: args.targetValue,
      currentValue: args.currentValue,
      days: args.days ?? 30,
    }),

  // Setting
  getSetting: (key: string) => invoke<string | null>("get_setting", { key }),
  setSetting: (key: string, value: string) =>
    invoke<void>("set_setting", { key, value }),
  listSettings: () =>
    invoke<{ key: string; value: string }[]>("list_settings"),

  // News & profile (Finnhub)
  fetchNewsForPortfolios: (profileId: number | null) =>
    invoke<
      {
        asset_symbol: string;
        asset_name: string;
        asset_type: string;
        icon_url: string | null;
        items: {
          headline: string;
          summary: string | null;
          url: string | null;
          source: string | null;
          image: string | null;
          datetime: number;
        }[];
      }[]
    >("fetch_news_for_portfolios", { profileId }),
  fetchStockProfile: (symbol: string) =>
    invoke<{
      name: string | null;
      logo: string | null;
      dividend_yield_pct: number | null;
    }>("fetch_stock_profile", { symbol }),

  // Backup
  exportData: () => invoke<string>("export_data"),
  triggerBackup: () => invoke<string>("trigger_backup"),
  importData: (json: string, mode: "replace" | "merge") =>
    invoke<{
      mode: string;
      portfolios_added: number;
      assets_added: number;
      transactions_added: number;
      alerts_added: number;
      goals_added: number;
    }>("import_data", { json, mode }),
};
