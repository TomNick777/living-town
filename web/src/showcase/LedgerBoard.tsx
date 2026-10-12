/**
 * 月报看板入口：把 ledger-board 适配器类型接到 MonthlyReport 的展示 props。
 * 呈现逻辑收敛在 MonthlyReport；这里只做薄接线，不加二次财务计算。
 */
import type { LifeScene, TownState } from "../town/adapter/townState";
import type { LedgerBoard } from "../town/adapter/ledgerBoard";
import MonthlyReport from "./MonthlyReport";

export function LedgerBoardPage(props: {
  town: TownState;
  board: LedgerBoard | null;
  loading: boolean;
  error: string | null;
  onOpenScene: (scene: LifeScene) => void;
  onOpenHealth: () => void;
  onOpenReview: () => void;
}) {
  return (
    <div className="ledger-page">
      <MonthlyReport
        town={props.town}
        board={props.board}
        loading={props.loading}
        error={props.error}
        onOpenScene={props.onOpenScene}
        onOpenHealth={props.onOpenHealth}
        onOpenReview={props.onOpenReview}
      />
    </div>
  );
}
