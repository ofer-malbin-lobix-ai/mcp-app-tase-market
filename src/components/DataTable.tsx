import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  getFilteredRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
  type PaginationState,
  type VisibilityState,
  type ColumnFiltersState,
  type Column,
  type FilterFn,
} from "@tanstack/react-table";
import { useState, useRef, useEffect, useMemo } from "react";
import styles from "./DataTable.module.css";

// Range filter for numeric columns
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const numberRangeFilter: FilterFn<any> = (row, columnId, filterValue: [number | "", number | ""]) => {
  const value = row.getValue(columnId) as number | null;
  if (value === null || value === undefined) return false;

  const [min, max] = filterValue;
  if (min !== "" && value < min) return false;
  if (max !== "" && value > max) return false;
  return true;
};

// Component for range filter input
function RangeFilter<T>({ column }: { column: Column<T, unknown> }) {
  const filterValue = (column.getFilterValue() as [number | "", number | ""]) ?? ["", ""];

  return (
    <div className={styles.rangeFilter}>
      <input
        type="number"
        value={filterValue[0]}
        onChange={(e) => {
          const val = e.target.value === "" ? "" : Number(e.target.value);
          column.setFilterValue([val, filterValue[1]]);
        }}
        placeholder="Min"
        className={styles.rangeInput}
        onClick={(e) => e.stopPropagation()}
      />
      <input
        type="number"
        value={filterValue[1]}
        onChange={(e) => {
          const val = e.target.value === "" ? "" : Number(e.target.value);
          column.setFilterValue([filterValue[0], val]);
        }}
        placeholder="Max"
        className={styles.rangeInput}
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

interface DataTableProps<T> {
  data: T[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  columns: ColumnDef<T, any>[];
  initialPageSize?: number;
  storageKey?: string;
  onFilteredRowsChange?: (rows: T[]) => void;
}

export function DataTable<T>({
  data,
  columns,
  initialPageSize = 25,
  storageKey = "table-column-visibility",
  onFilteredRowsChange,
}: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: initialPageSize,
  });
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  });

  // Save column visibility to localStorage when it changes
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(columnVisibility));
    } catch {
      // Ignore storage errors
    }
  }, [columnVisibility, storageKey]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [showColumnSelector, setShowColumnSelector] = useState(false);
  const columnSelectorRef = useRef<HTMLDivElement>(null);
  const columnSelectorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Auto-close column selector after inactivity
  const resetColumnSelectorTimeout = () => {
    if (columnSelectorTimeoutRef.current) {
      clearTimeout(columnSelectorTimeoutRef.current);
    }
    if (showColumnSelector) {
      columnSelectorTimeoutRef.current = setTimeout(() => {
        setShowColumnSelector(false);
      }, 3000);
    }
  };

  useEffect(() => {
    if (showColumnSelector) {
      resetColumnSelectorTimeout();
    }
    return () => {
      if (columnSelectorTimeoutRef.current) {
        clearTimeout(columnSelectorTimeoutRef.current);
      }
    };
  }, [showColumnSelector]);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (columnSelectorRef.current && !columnSelectorRef.current.contains(event.target as Node)) {
        setShowColumnSelector(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Detect which columns are numeric based on data
  const numericColumns = useMemo(() => {
    const numeric = new Set<string>();
    if (data.length > 0) {
      const sampleRow = data[0] as Record<string, unknown>;
      for (const key of Object.keys(sampleRow)) {
        const value = sampleRow[key];
        if (typeof value === "number" || (value === null && key !== "symbol" && key !== "marketType" && key !== "tradeDate")) {
          numeric.add(key);
        }
      }
    }
    return numeric;
  }, [data]);

  // Apply range filter function to numeric columns
  const columnsWithFilters = useMemo(() => {
    return columns.map((col) => {
      const colId = (col as { accessorKey?: string }).accessorKey ?? (col as { id?: string }).id;
      if (colId && numericColumns.has(colId)) {
        return {
          ...col,
          filterFn: numberRangeFilter,
        };
      }
      return col;
    });
  }, [columns, numericColumns]);

  const table = useReactTable({
    data,
    columns: columnsWithFilters,
    state: { sorting, pagination, columnVisibility, columnFilters, globalFilter },
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    onColumnVisibilityChange: setColumnVisibility,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  // Notify parent when filtered rows change
  const filteredRows = table.getFilteredRowModel().rows;
  useEffect(() => {
    if (onFilteredRowsChange) {
      onFilteredRowsChange(filteredRows.map(row => row.original));
    }
  }, [filteredRows, onFilteredRowsChange]);

  const pageCount = table.getPageCount();
  const currentPage = pagination.pageIndex + 1;

  const visibleCount = table.getVisibleLeafColumns().length;
  const totalCount = table.getAllLeafColumns().length;
  const filteredRowCount = table.getFilteredRowModel().rows.length;
  const hasActiveFilters = columnFilters.length > 0 || globalFilter !== "";

  const clearAllFilters = () => {
    setColumnFilters([]);
    setGlobalFilter("");
  };

  return (
    <div className={styles.tableWrapper}>
      <div className={styles.toolbar}>
        <div className={styles.searchBox}>
          <input
            type="text"
            placeholder="Search all columns..."
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            className={styles.searchInput}
          />
          {globalFilter && (
            <button
              className={styles.clearButton}
              onClick={() => setGlobalFilter("")}
            >
              ×
            </button>
          )}
        </div>

        <button
          className={`${styles.filterToggle} ${showFilters ? styles.active : ""}`}
          onClick={() => setShowFilters(!showFilters)}
        >
          Filters {hasActiveFilters && `(${columnFilters.length})`}
        </button>

        {hasActiveFilters && (
          <button className={styles.clearFiltersButton} onClick={clearAllFilters}>
            Clear All
          </button>
        )}

        <div className={styles.columnSelector} ref={columnSelectorRef}>
          <button
            className={styles.columnSelectorButton}
            onClick={() => setShowColumnSelector(!showColumnSelector)}
          >
            Columns ({visibleCount}/{totalCount})
          </button>
          {showColumnSelector && (
            <div className={styles.columnSelectorDropdown} onMouseMove={resetColumnSelectorTimeout} onMouseLeave={() => setShowColumnSelector(false)}>
              <div className={styles.columnSelectorHeader}>
                <label className={styles.columnCheckbox}>
                  <input
                    type="checkbox"
                    checked={table.getIsAllColumnsVisible()}
                    onChange={table.getToggleAllColumnsVisibilityHandler()}
                  />
                  <span>Toggle All</span>
                </label>
              </div>
              <div className={styles.columnSelectorList}>
                {table.getAllLeafColumns().map((column) => (
                  <label key={column.id} className={styles.columnCheckbox}>
                    <input
                      type="checkbox"
                      checked={column.getIsVisible()}
                      onChange={column.getToggleVisibilityHandler()}
                    />
                    <span>{String(column.columnDef.header ?? column.id)}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className={styles.tableContainer}>
        <table className={styles.table}>
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    onClick={header.column.getToggleSortingHandler()}
                    className={styles.th}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                    {{
                      asc: " ▲",
                      desc: " ▼",
                    }[header.column.getIsSorted() as string] ?? ""}
                  </th>
                ))}
              </tr>
            ))}
            {showFilters && (
              <tr className={styles.filterRow}>
                {table.getHeaderGroups()[0]?.headers.map((header) => {
                  const isNumeric = numericColumns.has(header.column.id);
                  return (
                    <th key={header.id} className={styles.filterCell}>
                      {header.column.getCanFilter() ? (
                        isNumeric ? (
                          <RangeFilter column={header.column} />
                        ) : (
                          <input
                            type="text"
                            value={(header.column.getFilterValue() as string) ?? ""}
                            onChange={(e) => header.column.setFilterValue(e.target.value)}
                            placeholder={`Filter...`}
                            className={styles.filterInput}
                            onClick={(e) => e.stopPropagation()}
                          />
                        )
                      ) : null}
                    </th>
                  );
                })}
              </tr>
            )}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id}>
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className={styles.td}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className={styles.pagination}>
        <div className={styles.pageInfo}>
          Showing {table.getRowModel().rows.length} of {filteredRowCount}
          {filteredRowCount !== data.length && ` (${data.length} total)`} rows
          {pageCount > 1 && ` · Page ${currentPage} of ${pageCount}`}
        </div>

        <div className={styles.pageControls}>
          <select
            value={pagination.pageSize}
            onChange={(e) => table.setPageSize(Number(e.target.value))}
            className={styles.pageSizeSelect}
          >
            {[10, 25, 50, 100, 200].map((size) => (
              <option key={size} value={size}>
                {size} rows
              </option>
            ))}
          </select>

          <div className={styles.pageButtons}>
            <button
              onClick={() => table.firstPage()}
              disabled={!table.getCanPreviousPage()}
              className={styles.pageButton}
            >
              ««
            </button>
            <button
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
              className={styles.pageButton}
            >
              «
            </button>
            <span className={styles.pageNumber}>
              {currentPage} / {pageCount}
            </span>
            <button
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
              className={styles.pageButton}
            >
              »
            </button>
            <button
              onClick={() => table.lastPage()}
              disabled={!table.getCanNextPage()}
              className={styles.pageButton}
            >
              »»
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
