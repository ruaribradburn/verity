/** Minimal typings for Bun built-ins when `tsc` runs without Bun's type bundle. */
declare module "bun:sqlite" {
  export class Database {
    constructor(filename: string);
    run(sql: string): void;
    prepare(sql: string): PreparedStatement;
  }

  export interface PreparedStatement {
    run(...args: unknown[]): unknown;
    all(...args: unknown[]): unknown[];
  }
}
