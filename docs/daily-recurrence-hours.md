# Daily recurrence workload fixes

For daily tasks, an explicit `focusHours` value (including zero) is the current-week planned total. It is not multiplied by working days. When no current-week total is present, the forecast uses the occurrence estimate times the member's working days. Future weeks continue to use that formula.

Daily forecasts start from `targetWeekStart`, falling back to `dueDate`, or the current week if neither exists. Starts beyond the four-week horizon are excluded rather than treated as this week. Past starts continue from this week. Forecast counts follow the same daily start boundary.

Current-week focus and inherited parent focus do not include daily tasks whose start week is in the future. The existing full-child-estimate allocation policy is preserved.

This fix does not change weekly, biweekly, or monthly recurrence forecasting, recurrence generation, or the stored task schema. Midweek starts retain the existing full-week working-day approximation.
