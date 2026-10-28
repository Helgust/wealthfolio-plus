//! Budget tools (wealthfolio-plus) - read the short-term budgets of the
//! Planificador ES addon and their month-by-month forecast, and prepare a
//! budget draft.
//!
//! The budgets live in the addon's storage (`budgets.v1`). The forecast is
//! computed by the addon's TypeScript engine and saved next to them
//! (`budgets.v1.forecast`) together with the budgets it was computed from; it
//! is stale when those differ from the current `budgets.v1`. The addon owns
//! the schema, so the values pass through as JSON.
//!
//! A draft goes to `budgets.v1.draft` (one slot; a new draft replaces the
//! pending one). The addon validates it with its schema and shows it for the
//! user to accept or reject; nothing here writes `budgets.v1`.

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
pub const BUDGET_DRAFT_KEY: &str = "budgets.v1.draft";
/// Longest draft note, in characters.
const MAX_DRAFT_NOTE: usize = 500;

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
         opening the Budget page in the addon recomputes it. `pendingDraft` is a draft from \
         prepare_budget_draft still waiting for the user."
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
        let draft = read(BUDGET_DRAFT_KEY).await?;
        let include_forecast = args.include_forecast.unwrap_or(true);
        let forecast = if include_forecast && budgets.is_some() {
            read(BUDGETS_FORECAST_KEY).await?
        } else {
            None
        };
        let content = budgets_output(
            budgets.as_deref(),
            forecast.as_deref(),
            draft.as_deref(),
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
    draft: Option<&str>,
    budget_id: Option<&str>,
    include_forecast: bool,
) -> Result<Value, AgentToolError> {
    // What the user is asked to review; the budget itself is what was sent.
    let pending_draft = match draft {
        None => Value::Null,
        Some(draft) => {
            let draft = parse(draft, BUDGET_DRAFT_KEY)?;
            json!({
                "target": draft.get("target").cloned().unwrap_or(Value::Null),
                "note": draft.get("note").cloned().unwrap_or(Value::Null),
                "createdAt": draft.get("createdAt").cloned().unwrap_or(Value::Null),
            })
        }
    };
    let Some(budgets) = budgets else {
        return Ok(json!({
            "budgets": [],
            "activeId": null,
            "forecast": null,
            "pendingDraft": pending_draft,
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
        "pendingDraft": pending_draft,
        "note": "Amounts are net euros per month; no taxes, returns or inflation. A loan's \
                 `payment` in a month is the one due the next month."
    }))
}

/// Arguments for the prepare_budget_draft tool.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareBudgetDraftArgs {
    /// Budget the draft replaces; a new budget when absent.
    pub budget_id: Option<String>,
    pub budget: Value,
    /// What changed and why, shown to the user.
    pub note: Option<String>,
}

/// Tool to propose a budget for the user to accept in the addon.
pub struct PrepareBudgetDraft;

/// JSON Schema of a budget, mirroring `plus/addon/src/model/budget.ts`. The addon
/// validates the draft with its own schema before the user can accept it.
fn budget_schema() -> Value {
    let month = json!({ "type": "string", "pattern": "^\\d{4}-(0[1-9]|1[0-2])$", "description": "YYYY-MM" });
    let nullable_month =
        json!({ "type": ["string", "null"], "pattern": "^\\d{4}-(0[1-9]|1[0-2])$" });
    let money = json!({ "type": "number", "minimum": 0 });
    let id = json!({ "type": "string", "pattern": "^[A-Za-z0-9_-]{1,40}$" });
    let nullable_id = json!({ "type": ["string", "null"], "pattern": "^[A-Za-z0-9_-]{1,40}$" });
    let name = json!({ "type": "string", "minLength": 1, "maxLength": 60 });
    let line = json!({
        "type": "object",
        "description": "A monthly amount from `from` up to, not including, `to`; null — from the start / to the end.",
        "properties": { "name": name, "amount": money, "from": nullable_month, "to": nullable_month },
        "required": ["name", "amount", "from", "to"],
        "additionalProperties": false
    });
    json!({
        "type": "object",
        "properties": {
            "name": name,
            "start": month,
            "months": { "type": "integer", "minimum": 1, "maximum": 36 },
            "incomes": { "type": "array", "maxItems": 30, "items": line, "description": "Net incomes per month" },
            "expenses": { "type": "array", "maxItems": 30, "items": line, "description": "Expenses per month: taxes set aside, living, ..." },
            "oneTime": {
                "type": "array", "maxItems": 100,
                "description": "One-time items. An expense with an envelope is paid from it after the month's deposit; what it lacks comes from the free money.",
                "items": {
                    "type": "object",
                    "properties": {
                        "name": name, "month": month, "amount": money,
                        "kind": { "enum": ["income", "expense"] },
                        "envelopeId": nullable_id
                    },
                    "required": ["name", "month", "amount", "kind", "envelopeId"],
                    "additionalProperties": false
                }
            },
            "envelopes": {
                "type": "array", "maxItems": 20,
                "description": "Savings pockets. accountId — the Wealthfolio account holding it (get_accounts), or null.",
                "items": {
                    "type": "object",
                    "properties": {
                        "id": id, "name": name,
                        "balance": { "type": "number", "minimum": 0, "description": "At the start of the first month" },
                        "accountId": { "type": ["string", "null"] }
                    },
                    "required": ["id", "name", "balance", "accountId"],
                    "additionalProperties": false
                }
            },
            "loans": {
                "type": "array", "maxItems": 10,
                "description": "Annuity loans. liabilityId — a Wealthfolio liability, or null.",
                "items": {
                    "type": "object",
                    "properties": {
                        "id": id, "name": name,
                        "balance": { "type": "number", "minimum": 0, "description": "At the start of the first month" },
                        "rate": { "type": "number", "minimum": 0, "maximum": 0.5, "description": "Annual TIN as a fraction: 0.08 is 8 %" },
                        "payment": money,
                        "liabilityId": { "type": ["string", "null"] }
                    },
                    "required": ["id", "name", "balance", "rate", "payment", "liabilityId"],
                    "additionalProperties": false
                }
            },
            "steps": {
                "type": "array", "maxItems": 30,
                "description": "The queue that shares out each month's free money, in order. fixed — an amount a month up to cap; fill — up to a target balance; rest — everything left. whileLoan — only while that loan has a balance.",
                "items": {
                    "oneOf": [
                        {
                            "type": "object",
                            "properties": {
                                "kind": { "const": "fixed" }, "envelopeId": id, "amount": money,
                                "cap": { "type": ["number", "null"], "minimum": 0 }, "whileLoan": nullable_id
                            },
                            "required": ["kind", "envelopeId", "amount", "cap", "whileLoan"],
                            "additionalProperties": false
                        },
                        {
                            "type": "object",
                            "properties": { "kind": { "const": "fill" }, "envelopeId": id, "target": money },
                            "required": ["kind", "envelopeId", "target"],
                            "additionalProperties": false
                        },
                        {
                            "type": "object",
                            "properties": { "kind": { "const": "rest" }, "envelopeId": id, "whileLoan": nullable_id },
                            "required": ["kind", "envelopeId", "whileLoan"],
                            "additionalProperties": false
                        }
                    ]
                }
            },
            "prepayments": {
                "type": "array", "maxItems": 10,
                "description": "The envelope goes into the loan at the end of the given calendar months (1-12), and at once when it covers the balance; once the loan is repaid, the rest returns to the free money. effect: payment — reducir cuota, term — reducir plazo.",
                "items": {
                    "type": "object",
                    "properties": {
                        "envelopeId": id, "loanId": id,
                        "months": { "type": "array", "maxItems": 12, "items": { "type": "integer", "minimum": 1, "maximum": 12 } },
                        "effect": { "enum": ["term", "payment"] }
                    },
                    "required": ["envelopeId", "loanId", "months", "effect"],
                    "additionalProperties": false
                }
            }
        },
        "required": ["name", "start", "months", "incomes", "expenses", "oneTime", "envelopes", "loans", "steps", "prepayments"],
        "additionalProperties": false
    })
}

#[async_trait::async_trait]
impl AgentTool for PrepareBudgetDraft {
    fn name(&self) -> &'static str {
        "prepare_budget_draft"
    }

    fn description(&self) -> &'static str {
        "Propose a short-term budget for the Planificador ES addon: a whole budget that replaces \
         an existing one (budgetId from get_budgets) or a new one. Nothing is saved until the user \
         accepts the draft on the addon's Budget page, where it is validated and previewed; a new \
         draft replaces a pending one. Send the complete budget, not a patch: read it with \
         get_budgets, change it, send it back. Amounts are net euros per month."
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "budgetId": {
                    "type": "string",
                    "description": "Budget the draft replaces; omit for a new budget."
                },
                "budget": budget_schema(),
                "note": {
                    "type": "string",
                    "maxLength": MAX_DRAFT_NOTE,
                    "description": "What changed and why; shown to the user next to the draft."
                }
            },
            "required": ["budget"]
        })
    }

    fn required_scopes(&self) -> &'static [AgentScope] {
        &[
            AgentScope::FinancialPlanningRead,
            AgentScope::FinancialPlanningDraft,
        ]
    }

    fn access_level(&self) -> AgentToolAccess {
        AgentToolAccess::Draft
    }

    fn sanitize_args_for_audit(&self, args: &Value) -> Value {
        // The budget carries the household's amounts: the audit log keeps only the target.
        json!({ "budgetId": args.get("budgetId").cloned().unwrap_or(Value::Null) })
    }

    async fn call(
        &self,
        env: Arc<dyn AgentEnvironment>,
        args: Value,
    ) -> Result<AgentToolResult, AgentToolError> {
        let args: PrepareBudgetDraftArgs = serde_json::from_value(args)?;
        let addons = env.addon_service().ok_or_else(|| {
            AgentToolError::ExecutionFailed("Addon storage is not available".to_string())
        })?;
        let budgets = addons
            .get_addon_storage_item(PLANNER_ADDON_ID, BUDGETS_KEY)
            .await
            .map_err(AgentToolError::ExecutionFailed)?;
        let record = draft_record(budgets.as_deref(), args, chrono::Utc::now().to_rfc3339())?;
        addons
            .set_addon_storage_item(PLANNER_ADDON_ID, BUDGET_DRAFT_KEY, &record.to_string())
            .await
            .map_err(AgentToolError::ExecutionFailed)?;
        Ok(AgentToolResult {
            content: json!({
                "status": "pending",
                "target": record["target"],
                "message": "Draft saved. The user reviews it on the Budget page of Planificador ES; \
                            it is validated there and saved only if they accept it."
            }),
        })
    }
}

/// The stored draft: checks what can be checked without the addon's schema.
pub fn draft_record(
    budgets: Option<&str>,
    args: PrepareBudgetDraftArgs,
    created_at: String,
) -> Result<Value, AgentToolError> {
    if !args.budget.is_object() {
        return Err(AgentToolError::InvalidInput(
            "budget must be an object".to_string(),
        ));
    }
    let note = args.note.unwrap_or_default();
    if note.chars().count() > MAX_DRAFT_NOTE {
        return Err(AgentToolError::InvalidInput(format!(
            "note is longer than {MAX_DRAFT_NOTE} characters"
        )));
    }
    if let Some(id) = &args.budget_id {
        let book = match budgets {
            Some(json) => parse(json, BUDGETS_KEY)?,
            None => Value::Null,
        };
        let exists = book
            .get("entries")
            .and_then(Value::as_array)
            .is_some_and(|entries| {
                entries
                    .iter()
                    .any(|e| e.get("id").and_then(Value::as_str) == Some(id.as_str()))
            });
        if !exists {
            return Err(AgentToolError::InvalidInput(format!(
                "No budget with id '{id}'; omit budgetId to propose a new budget"
            )));
        }
    }
    Ok(json!({
        "target": args.budget_id,
        "note": note,
        "createdAt": created_at,
        "budget": args.budget,
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
        let out = budgets_output(None, None, None, None, true).unwrap();
        assert_eq!(out["budgets"], json!([]));
        assert!(out["forecast"].is_null());
    }

    #[test]
    fn active_budget_forecast_is_fresh() {
        let out = budgets_output(Some(BOOK), Some(&forecast(BOOK)), None, None, true).unwrap();
        assert_eq!(out["activeId"], "a");
        assert_eq!(out["budgets"].as_array().unwrap().len(), 2);
        assert_eq!(out["forecast"]["budgetId"], "a");
        assert_eq!(out["forecast"]["stale"], false);
        assert_eq!(out["forecast"]["months"][0]["month"], "2026-11");
    }

    #[test]
    fn forecast_of_changed_budgets_is_stale() {
        let old = BOOK.replace("\"A\"", "\"Old\"");
        let out = budgets_output(Some(BOOK), Some(&forecast(&old)), None, Some("b"), true).unwrap();
        assert_eq!(out["forecast"]["budgetId"], "b");
        assert_eq!(out["forecast"]["stale"], true);
    }

    #[test]
    fn missing_forecast_is_stale_and_empty() {
        let out = budgets_output(Some(BOOK), None, None, None, true).unwrap();
        assert_eq!(out["forecast"]["stale"], true);
        assert_eq!(out["forecast"]["months"], json!([]));
    }

    #[test]
    fn forecast_can_be_left_out() {
        let out = budgets_output(Some(BOOK), Some(&forecast(BOOK)), None, None, false).unwrap();
        assert!(out["forecast"].is_null());
    }

    #[test]
    fn unknown_budget_is_an_input_error() {
        let err = budgets_output(Some(BOOK), None, None, Some("zzz"), true).unwrap_err();
        assert!(matches!(err, AgentToolError::InvalidInput(_)));
    }

    #[test]
    fn broken_record_is_an_execution_error() {
        let err = budgets_output(Some("{"), None, None, None, true).unwrap_err();
        assert!(matches!(err, AgentToolError::ExecutionFailed(_)));
    }

    fn draft_args(
        budget_id: Option<&str>,
        budget: Value,
        note: Option<&str>,
    ) -> PrepareBudgetDraftArgs {
        PrepareBudgetDraftArgs {
            budget_id: budget_id.map(str::to_string),
            budget,
            note: note.map(str::to_string),
        }
    }

    #[test]
    fn draft_for_an_existing_budget() {
        let args = draft_args(Some("b"), json!({ "name": "B2" }), Some("Lower spending"));
        let record = draft_record(Some(BOOK), args, "t".to_string()).unwrap();
        assert_eq!(record["target"], "b");
        assert_eq!(record["note"], "Lower spending");
        assert_eq!(record["budget"]["name"], "B2");
    }

    #[test]
    fn draft_for_a_new_budget_needs_no_budgets() {
        let record =
            draft_record(None, draft_args(None, json!({}), None), "t".to_string()).unwrap();
        assert!(record["target"].is_null());
        assert_eq!(record["note"], "");
    }

    #[test]
    fn draft_rejects_unknown_target_non_object_and_long_note() {
        let unknown = draft_record(
            Some(BOOK),
            draft_args(Some("zzz"), json!({}), None),
            "t".into(),
        );
        assert!(matches!(unknown, Err(AgentToolError::InvalidInput(_))));
        let not_object = draft_record(None, draft_args(None, json!([1]), None), "t".into());
        assert!(matches!(not_object, Err(AgentToolError::InvalidInput(_))));
        let long = "x".repeat(MAX_DRAFT_NOTE + 1);
        let long_note = draft_record(None, draft_args(None, json!({}), Some(&long)), "t".into());
        assert!(matches!(long_note, Err(AgentToolError::InvalidInput(_))));
    }

    #[test]
    fn pending_draft_is_reported() {
        let draft = r#"{"target":"a","note":"n","createdAt":"t","budget":{}}"#;
        let out = budgets_output(Some(BOOK), None, Some(draft), None, false).unwrap();
        assert_eq!(out["pendingDraft"]["target"], "a");
        assert_eq!(out["pendingDraft"]["note"], "n");
        let none = budgets_output(None, None, Some(draft), None, false).unwrap();
        assert_eq!(none["pendingDraft"]["target"], "a");
    }

    #[test]
    fn audit_keeps_only_the_target() {
        let args =
            json!({ "budgetId": "a", "budget": { "incomes": [{ "amount": 1 }] }, "note": "n" });
        assert_eq!(
            PrepareBudgetDraft.sanitize_args_for_audit(&args),
            json!({ "budgetId": "a" })
        );
    }
}
