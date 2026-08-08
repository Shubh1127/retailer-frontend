const DEPT_COLORS: Record<string, string> = {
  "Soft Drinks": "#0F766E",
  "Ambient Grocery": "#B45309",
  Chilled: "#4F46E5",
  Confectionery: "#BE123C",
  Bakery: "#B45309",
};

export default function ProductGlyph({ department, size = 44 }: { department: string; size?: number }) {
  const color = DEPT_COLORS[department] ?? "#6B7280";
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-lg font-semibold text-white"
      style={{ width: size, height: size, backgroundColor: color, fontSize: size * 0.34 }}
    >
      {department.slice(0, 1)}
    </div>
  );
}
