import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";

type Category = { id: string; name: string };

export function GroupPicker({ cats, groups, groupCat, groupLabels, category, group, noGroup, label, onChange }: {
  cats: Category[]; groups?: string[]; groupCat?: Record<string, string>; groupLabels?: Record<string, string>; category: string; group?: string; noGroup?: string; label: string;
  onChange: (category: string, group: string) => void;
}) {
  const value = JSON.stringify([category, group ?? ""]);
  return (
    <Select value={value} onValueChange={(next) => { const [cat, name] = JSON.parse(next) as [string, string]; onChange(cat, name); }}>
      <SelectTrigger aria-label={label} className="field w-full min-w-0 max-w-[360px] font-normal normal-case [&>span]:truncate"><SelectValue /></SelectTrigger>
      <SelectContent className="w-[360px] max-w-[calc(100vw-24px)] rounded-none">
        {cats.map((cat) => (
          <SelectGroup key={cat.id}>
            {groups && <SelectLabel className="whitespace-normal break-words text-xs">{cat.name}</SelectLabel>}
            <SelectItem value={JSON.stringify([cat.id, ""])} className="whitespace-normal break-words text-xs">{cat.name}{groups ? ` — ${noGroup}` : ""}</SelectItem>
            {groups?.filter((name) => (groupCat?.[name] ?? "general") === cat.id).map((name) => <SelectItem key={name} value={JSON.stringify([cat.id, name])} className="whitespace-normal break-words text-xs">{cat.name} / {groupLabels?.[name] ?? name}</SelectItem>)}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}