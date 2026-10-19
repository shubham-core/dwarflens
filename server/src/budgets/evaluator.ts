export interface ProjectBudgets {
  max_total_size?: number; // max file size in bytes
  max_growth_bytes?: number; // max growth in bytes from base
  fail_on_padding_regression?: boolean; // fail if total struct padding increases
}

export interface BudgetEvaluationResult {
  passed: boolean;
  reasons: string[];
}

export function evaluateBudgets(params: {
  budgets?: ProjectBudgets;
  currentSize: number;
  currentPadding: number;
  baseSize?: number | null;
  basePadding?: number | null;
}): BudgetEvaluationResult {
  const { budgets, currentSize, currentPadding, baseSize, basePadding } = params;

  if (!budgets) {
    return { passed: true, reasons: [] };
  }

  const reasons: string[] = [];

  // 1. Max total size check
  if (budgets.max_total_size && budgets.max_total_size > 0) {
    if (currentSize > budgets.max_total_size) {
      reasons.push(
        `Binary size (${currentSize.toLocaleString()} B) exceeds project max total size budget (${budgets.max_total_size.toLocaleString()} B)`
      );
    }
  }

  // 2. Growth bytes check (if base is known)
  if (
    budgets.max_growth_bytes !== undefined &&
    budgets.max_growth_bytes >= 0 &&
    baseSize !== undefined &&
    baseSize !== null
  ) {
    const growth = currentSize - baseSize;
    if (growth > budgets.max_growth_bytes) {
      reasons.push(
        `Binary growth (+${growth.toLocaleString()} B) exceeds max growth budget (+${budgets.max_growth_bytes.toLocaleString()} B)`
      );
    }
  }

  // 3. Fail on padding regression
  if (
    budgets.fail_on_padding_regression &&
    basePadding !== undefined &&
    basePadding !== null
  ) {
    const paddingGrowth = currentPadding - basePadding;
    if (paddingGrowth > 0) {
      reasons.push(
        `Struct padding regression detected (+${paddingGrowth.toLocaleString()} B of wasted memory)`
      );
    }
  }

  return {
    passed: reasons.length === 0,
    reasons,
  };
}
