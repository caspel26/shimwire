import pc from "picocolors";

export const log = {
  info: (message: string) => console.log(message),
  dim: (message: string) => console.log(pc.dim(message)),
  success: (message: string) => console.log(pc.green(message)),
  warn: (message: string) => console.log(pc.yellow(message)),
  error: (message: string) => console.error(pc.red(message)),
};
