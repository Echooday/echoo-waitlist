/// <reference types="vite/client" />

declare module "virtual:left-mockups" {
  const files: readonly { image: string; fileName: string }[];
  export default files;
}
