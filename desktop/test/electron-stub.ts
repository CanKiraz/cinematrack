// Stands in for the `electron` module in unit tests: the database code only asks where the user data folder is.
export const app = { getPath: (_name: string): string => process.env.CT_TEST_DIR as string }
