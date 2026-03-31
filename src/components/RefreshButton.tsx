import styles from "./RefreshButton.module.css";

interface RefreshButtonProps {
  onClick: () => void;
  isRefreshing: boolean;
  label?: string;
  loadingLabel?: string;
  disabled?: boolean;
}

export function RefreshButton({
  onClick,
  isRefreshing,
  label = "Refresh",
  loadingLabel = "Loading...",
  disabled = false,
}: RefreshButtonProps) {
  return (
    <button
      className={styles.refreshButton}
      onClick={onClick}
      disabled={isRefreshing || disabled}
    >
      {isRefreshing ? loadingLabel : label}
    </button>
  );
}
