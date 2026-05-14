mod commands;
mod db;
mod error;
pub mod services;

use services::Db;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        // plugin-sql migration listesi olmadan kuruluyor — migration'ları
        // services/db_pool yönetiyor. Plugin sadece frontend için backup
        // olarak kalsın (kullanılmayacak ama capability'leri kayıtlı).
        .plugin(tauri_plugin_sql::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let handle = app.handle().clone();
            // DB pool boot'ta async init. Hata olursa app start fail.
            let db = tauri::async_runtime::block_on(async {
                Db::init(&handle).await
            })?;
            app.manage(db);

            // Alarm background loop (5 dk tick) — PLAN §6.1.F
            services::alarm_loop::spawn(app.handle().clone());
            // Günlük otomatik backup — PLAN §12 Faz 7
            services::backup::spawn_daily(app.handle().clone());
            // Binance WebSocket — kripto canlı fiyat akışı
            services::binance_ws::spawn(app.handle().clone());

            Ok(())
        });

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }

    builder
        .invoke_handler(tauri::generate_handler![
            commands::health::db_health_check,
            commands::profile::create_profile,
            commands::profile::list_profiles,
            commands::profile::rename_profile,
            commands::profile::delete_profile,
            commands::profile::set_profile_pin,
            commands::portfolio::create_portfolio,
            commands::portfolio::list_portfolios,
            commands::portfolio::delete_portfolio,
            commands::portfolio::set_portfolio_pin,
            commands::portfolio::rename_portfolio,
            commands::budget::create_budget,
            commands::budget::list_budgets,
            commands::budget::update_budget,
            commands::budget::delete_budget,
            commands::budget::set_budget_pin,
            commands::budget::upsert_budget_line,
            commands::budget::list_budget_lines,
            commands::budget::delete_budget_line,
            commands::budget::set_budget_month_override,
            commands::budget::list_budget_month_overrides,
            commands::budget::compute_budget_plan,
            commands::budget::project_budget,
            commands::asset::create_asset,
            commands::asset::find_or_create_asset,
            commands::asset::list_assets,
            commands::asset::delete_asset,
            commands::asset::update_asset_yield,
            commands::asset::update_asset_platform,
            commands::transaction::create_transaction,
            commands::transaction::create_swap_transaction,
            commands::transaction::move_asset_to_portfolio,
            commands::transaction::update_transaction,
            commands::transaction::list_transactions,
            commands::transaction::list_transaction_tags,
            commands::transaction::list_tags_of_transaction,
            commands::transaction::soft_delete_transaction,
            commands::transaction::hard_delete_transaction,
            commands::transaction::restore_transaction,
            commands::price::fetch_crypto_price,
            commands::price::fetch_stock_price_yahoo,
            commands::news::fetch_news_for_portfolios,
            commands::news::fetch_stock_profile,
            commands::price::fetch_fx_rates,
            commands::price::get_cached_price,
            commands::price::refresh_all_prices,
            commands::search::search_symbol,
            commands::calc::validate_sale,
            commands::calc::calculate_portfolio,
            commands::calc::calculate_passive_income,
            commands::home::home_summary,
            commands::history::fetch_asset_history,
            commands::history::fetch_portfolio_history,
            commands::investment::upsert_investment_entry,
            commands::investment::list_investment_entries,
            commands::investment::delete_investment_entry,
            commands::alert::create_alert,
            commands::alert::update_alert,
            commands::alert::list_alerts,
            commands::alert::delete_alert,
            commands::alert::check_alerts,
            commands::goal::create_goal,
            commands::goal::list_goals,
            commands::goal::check_goal_achievement,
            commands::snapshot::estimate_goal_pace,
            commands::setting::get_setting,
            commands::setting::set_setting,
            commands::setting::list_settings,
            commands::backup::export_data,
            commands::backup::import_data,
            commands::backup::trigger_backup,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
