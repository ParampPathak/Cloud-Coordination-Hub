import type { ReactNode } from 'react';

export function ManagementTable<T>({
  rows,
  columns,
  rowKey,
}: {
  rows: T[];
  columns: { title: string; cell: (row: T) => ReactNode }[];
  rowKey: (row: T) => string | number;
}) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            {columns.map((column) => (
              <th scope="col" key={column.title}>
                {column.title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((column) => (
                <td key={column.title}>{column.cell(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
