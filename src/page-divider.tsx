type PageDividerProps = {
  variant: "gradient" | "gradient-bold";
  className?: string;
};

export function PageDivider({ variant, className = "" }: PageDividerProps) {
  const rootClass = ["page-divider", `page-divider--${variant}`, className.trim()]
    .filter(Boolean)
    .join(" ");

  return <div className={rootClass} aria-hidden="true" />;
}
