//! Budget tool (wealthfolio-plus) - read the short-term budgets of the
//! Planificador ES addon and their month-by-month forecast.
//!
//! The budgets live in the addon's storage (`budgets.v1`). The forecast is
//! computed by the addon's TypeScript engine and saved next to them
//! (`budgets.v1.forecast`) together with the budgets it was computed from; it
//! is stale when those differ from the current `budgets.v1`. The addon owns
//! the schema, so the values pass through as JSON.

use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;

use crate::env::AgentEnvironment;
use crate::scope::AgentScope;
use crate::tool::{AgentTool, AgentToolAccess, AgentToolError, AgentToolResult};

/// Addon id of Planificador ES (its `manifest.json`).
pub const PLANNER_ADDON_ID: &str = "planificador-es";
/// Storage keys written by the addon (`plus/addon/src/model/budget-storage.ts`).
pub const BUDGETS_KEY: &str = "budgets.v1";
pub const BUDGETS_FORECAST_KEY: &str = "budgets.v1.forecast";

/// Arguments for the get_budgets tool.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetBudgetsArgs {
    /// Budget whose forecast to return; the active one when absent.
    pub budget_id: Option<String>,
    /// Return the forecast (default true).
    pub include_forecast: Option<bool>,
}

/// Tool to read the addon's budgets and one budget's forecast.
pub struct GetBudgets;

#[async_trait::async_trait]
impl AgentTool for GetBudgets {
    fn name(&self) -> &'static str {
        "get_budgets"
    }

    fn description(&self) -> &'static str {
        "Get the short-term budgets of the Planificador ES addon: net monthly incomes and expenses, \
         envelopes (savings pockets, optionally linked to Wealthfolio accounts), loans, the queue \
         that shares out each month's free money, prepayments and one-time items. With the \
         forecast: month-by-month balances of every envelope and loan for one budget (the active \
         one by default). `stale: true` means the budgets changed since the forecast was computed; \
         opening the Budget page in the addon recomputes it."
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "budgetId": {
                    "type": "string",
                    "description": "Budget whose forecast to return; defaults to the active budget."
                },
                "includeForecast": {
                    "type": "boolean",
                    "description": "Return the month-by-month forecast (default true)."
                }
            },
            "required": []
        })
    }

    fn required_scopes(&self) -> &'static [AgentScope] {
        &[AgentScope::FinancialPlanningRead]
    }

    fn access_level(&self) -> AgentToolAccess {
        AgentToolAccess::Read
    }

    async fn call(
        &self,
        env: Arc<dyn AgentEnvironment>,
        args: Value,
    ) -> Result<AgentToolResult, AgentToolError> {
        let args: GetBudgetsArgs = serde_json::from_value(args)?;
        let addons = env.addon_service().ok_or_else(|| {
            AgentToolError::ExecutionFailed("Addon storage is not available".to_string())
        })?;
        let read = |key: &'static str| {
            let addons = addons.clone();
            async move {
                addons
                    .get_addon_storage_item(PLANNER_ADDON_ID, key)
                    .await
                    .map_err(AgentToolError::ExecutionFailed)
            }
        };
        let budgets = read(BUDGETS_KEY).await?;
        let include_forecast = args.include_forecast.unwrap_or(true);
        let forecast = if include_forecast && budgets.is_some() {
            read(BUDGETS_FORECAST_KEY).await?
        } else {
            None
        };
        let content = budgets_output(
            budgets.as_deref(),
            forecast.as_deref(),
            args.budget_id.as_deref(),
            include_forecast,
        )?;
        Ok(AgentToolResult { content })
    }
}

fn parse(json: &str, key: &str) -> Result<Value, AgentToolError> {
    serde_json::from_str(json)
        .map_err(|e| AgentToolError::ExecutionFailed(format!("{key} is not valid JSON: {e}")))
}

/// Builds the tool output from the stored records.
pub fn budgets_output(
    budgets: Option<&str>,
    forecast: Option<&str>,
    budget_id: Option<&str>,
    include_forecast: bool,
) -> Result<Value, AgentToolError> {
    let Some(budgets) = budgets else {
        return Ok(json!({
            "budgets": [],
            "activeId": null,
            "forecast": null,
            "note": "No budgets saved yet: create one on the Budget page of Planificador ES."
        }));
    };
    let book = parse(budgets, BUDGETS_KEY)?;
    let active_id = book.get("activeId").cloned().unwrap_or(Value::Null);
    let entries = book
        .get("entries")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let id = budget_id
        .map(str::to_string)
        .or_else(|| active_id.as_str().map(str::to_string));
    if let Some(id) = budget_id {
        if !entries
            .iter()
            .any(|e| e.get("id").and_then(Value::as_str) == Some(id))
        {
            return Err(AgentToolError::InvalidInput(format!(
                "No budget with id '{id}'"
            )));
        }
    }

    let forecast = match (include_forecast, forecast, id) {
        (false, _, _) | (_, _, None) => Value::Null,
        (true, None, Some(id)) => json!({ "budgetId": id, "stale": true, "months": [] }),
        (true, Some(forecast), Some(id)) => {
            let forecast = parse(forecast, BUDGETS_FORECAST_KEY)?;
            let stale = forecast.get("budgets") != Some(&book);
            let months = forecast
                .get("rows")
                .and_then(|rows| rows.get(&id))
                .cloned()
                .unwrap_or_else(|| json!([]));
            json!({ "budgetId": id, "stale": stale, "months": months })
        }
    };

    Ok(json!({
        "budgets": entries,
        "activeId": active_id,
        "forecast": forecast,
        "note": "Amounts are net euros per month; no taxes, returns or inflation. A loan's \
                 `payment` in a month is the one due the next month."
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    const BOOK: &str = r#"{"activeId":"a","entries":[{"id":"a","budget":{"name":"A"}},{"id":"b","budget":{"name":"B"}}]}"#;

    fn forecast(book: &str) -> String {
        format!(r#"{{"budgets":{book},"rows":{{"a":[{{"month":"2026-11"}}],"b":[]}}}}"#)
    }

    #[test]
    fn no_budgets_yet() {
        let out = budgets_output(None, None, None, true).unwrap();
        assert_eq!(out["budgets"], json!([]));
        assert!(out["forecast"].is_null());
    }

    #[test]
    fn active_budget_forecast_is_fresh() {
        let out = budgets_output(Some(BOOK), Some(&forecast(BOOK)), None, true).unwrap();
        assert_eq!(out["activeId"], "a");
        assert_eq!(out["budgets"].as_array().unwrap().len(), 2);
        assert_eq!(out["forecast"]["budgetId"], "a");
        assert_eq!(out["forecast"]["stale"], false);
        assert_eq!(out["forecast"]["months"][0]["month"], "2026-11");
    }

    #[test]
    fn forecast_of_changed_budgets_is_stale() {
        let old = BOOK.replace("\"A\"", "\"Old\"");
        let out = budgets_output(Some(BOOK), Some(&forecast(&old)), Some("b"), true).unwrap();
        assert_eq!(out["forecast"]["budgetId"], "b");
        assert_eq!(out["forecast"]["stale"], true);
    }

    #[test]
    fn missing_forecast_is_stale_and_empty() {
        let out = budgets_output(Some(BOOK), None, None, true).unwrap();
        assert_eq!(out["forecast"]["stale"], true);
        assert_eq!(out["forecast"]["months"], json!([]));
    }

    #[test]
    fn forecast_can_be_left_out() {
        let out = budgets_output(Some(BOOK), Some(&forecast(BOOK)), None, false).unwrap();
        assert!(out["forecast"].is_null());
    }

    #[test]
    fn unknown_budget_is_an_input_error() {
        let err = budgets_output(Some(BOOK), None, Some("zzz"), true).unwrap_err();
        assert!(matches!(err, AgentToolError::InvalidInput(_)));
    }

    #[test]
    fn broken_record_is_an_execution_error() {
        let err = budgets_output(Some("{"), None, None, true).unwrap_err();
        assert!(matches!(err, AgentToolError::ExecutionFailed(_)));
    }
}
