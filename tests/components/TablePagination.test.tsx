import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  TablePagination,
  useClientPagination,
} from "@/components/usage/TablePagination";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options && "total" in options ? `${key}:${options.total}` : key,
    i18n: { resolvedLanguage: "en", language: "en" },
  }),
}));

function Harness({ count }: { count: number }) {
  const [filter, setFilter] = useState("a");
  const rows = Array.from({ length: count }, (_, i) => `row-${i + 1}`);
  const pagination = useClientPagination(rows, filter);
  return (
    <div>
      <button type="button" onClick={() => setFilter("b")}>
        change-filter
      </button>
      <ul>
        {pagination.pageRows.map((row) => (
          <li key={row}>{row}</li>
        ))}
      </ul>
      <TablePagination
        page={pagination.page}
        totalPages={pagination.totalPages}
        total={pagination.total}
        onPageChange={pagination.setPage}
      />
    </div>
  );
}

describe("useClientPagination + TablePagination", () => {
  it("pages rows 20 at a time and resets when the filter changes", async () => {
    const user = userEvent.setup();
    render(<Harness count={45} />);

    expect(screen.getByText("usage.totalRecords:45")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(20);
    expect(screen.getByText("/ 3")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "usage.prevPage" }),
    ).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "usage.nextPage" }));
    expect(screen.getByText("row-21")).toBeInTheDocument();

    // 输入页码跳到最后一页：只剩 5 行
    const input = screen.getByRole("textbox", {
      name: "usage.pageInputPlaceholder",
    });
    await user.clear(input);
    await user.type(input, "3{Enter}");
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
    expect(
      screen.getByRole("button", { name: "usage.nextPage" }),
    ).toBeDisabled();

    // 超出范围的页码不生效
    await user.clear(input);
    await user.type(input, "9{Enter}");
    expect(screen.getByText("row-41")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "change-filter" }));
    expect(screen.getByText("row-1")).toBeInTheDocument();
  });

  it("clamps to the last page when rows shrink", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Harness count={45} />);
    await user.click(screen.getByRole("button", { name: "usage.nextPage" }));
    await user.click(screen.getByRole("button", { name: "usage.nextPage" }));
    expect(screen.getByText("row-41")).toBeInTheDocument();

    rerender(<Harness count={25} />);
    expect(screen.getByText("row-21")).toBeInTheDocument();
    expect(screen.getByText("/ 2")).toBeInTheDocument();
  });
});

// 注意：测试环境的 i18n 资源是空的（tests/setupTests.ts 里 resources 只有空对象），
// t("usage.firstPage") 会原样返回 key，所以断言的是 **i18n key**，不是中文。
describe("TablePagination 首页 / 尾页", () => {
  it("单页时不显示首页/尾页按钮", () => {
    render(
      <TablePagination
        page={0}
        totalPages={1}
        total={3}
        onPageChange={() => {}}
      />,
    );
    expect(screen.queryByLabelText("usage.firstPage")).toBeNull();
    expect(screen.queryByLabelText("usage.lastPage")).toBeNull();
  });

  it("多页时首页跳到第 1 页、尾页跳到最后一页", async () => {
    const onPageChange = vi.fn();
    render(
      <TablePagination
        page={1}
        totalPages={5}
        total={90}
        onPageChange={onPageChange}
      />,
    );
    await userEvent.click(screen.getByLabelText("usage.firstPage"));
    expect(onPageChange).toHaveBeenCalledWith(0);
    onPageChange.mockClear();
    await userEvent.click(screen.getByLabelText("usage.lastPage"));
    expect(onPageChange).toHaveBeenCalledWith(4);
  });

  it("已在首/尾页时对应按钮禁用", () => {
    const { rerender } = render(
      <TablePagination
        page={0}
        totalPages={3}
        total={50}
        onPageChange={() => {}}
      />,
    );
    expect(screen.getByLabelText("usage.firstPage")).toBeDisabled();
    rerender(
      <TablePagination
        page={2}
        totalPages={3}
        total={50}
        onPageChange={() => {}}
      />,
    );
    expect(screen.getByLabelText("usage.lastPage")).toBeDisabled();
  });
});
