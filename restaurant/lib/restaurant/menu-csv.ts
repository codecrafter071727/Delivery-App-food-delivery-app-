export type ParsedCsvItem = {
  name: string;
  description?: string;
  price: number;
  discountPrice?: number;
  isVeg?: boolean;
  spiceLevel?: string;
  tags?: string[];
};

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === ',' && !inQuotes) {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

function truthy(value: string | undefined) {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'veg'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n', 'nonveg', 'non-veg'].includes(normalized)) return false;
  return undefined;
}

export function parseMenuCsv(raw: string): ParsedCsvItem[] {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) return [];

  const headers = splitCsvLine(lines[0]).map((header) =>
    header.trim().toLowerCase().replace(/\s+/g, '')
  );

  const indexOf = (...names: string[]) =>
    headers.findIndex((header) => names.includes(header));

  const nameIdx = indexOf('name', 'itemname', 'item');
  const descIdx = indexOf('description', 'desc');
  const priceIdx = indexOf('price');
  const discountIdx = indexOf('discountprice', 'discount', 'offerprice');
  const vegIdx = indexOf('isveg', 'veg');
  const spiceIdx = indexOf('spicelevel', 'spice');
  const tagsIdx = indexOf('tags', 'tag');

  if (nameIdx < 0 || priceIdx < 0) {
    throw new Error(
      'CSV must include headers: name, description, price, discountPrice, isVeg, spiceLevel, tags'
    );
  }

  const items: ParsedCsvItem[] = [];

  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    const name = cells[nameIdx]?.trim();
    const price = Number(cells[priceIdx]);
    if (!name || !Number.isFinite(price)) continue;

    const discountRaw = discountIdx >= 0 ? cells[discountIdx] : undefined;
    const discountPrice =
      discountRaw != null && discountRaw !== ''
        ? Number(discountRaw)
        : undefined;

    const tagsRaw = tagsIdx >= 0 ? cells[tagsIdx] : undefined;
    const tags = tagsRaw
      ? tagsRaw
          .split(/[;|]/)
          .map((tag) => tag.trim())
          .filter(Boolean)
      : undefined;

    if (!Number.isFinite(price) || price <= 0) continue;

    const spiceRaw = spiceIdx >= 0 ? cells[spiceIdx] : undefined;
    const spice = spiceRaw
      ? spiceRaw.trim().toLowerCase().replace(/[\s-]+/g, '_')
      : undefined;
    const spiceLevel = (
      ['none', 'mild', 'medium', 'hot', 'extra_hot'] as const
    ).includes(spice as 'none')
      ? spice
      : undefined;

    const offer =
      Number.isFinite(discountPrice) &&
      discountPrice != null &&
      discountPrice > 0 &&
      discountPrice < price
        ? discountPrice
        : undefined;

    items.push({
      name,
      description: descIdx >= 0 ? cells[descIdx] || undefined : undefined,
      price,
      discountPrice: offer,
      isVeg: vegIdx >= 0 ? (truthy(cells[vegIdx]) ?? true) : true,
      spiceLevel,
      tags,
    });
  }

  return items.slice(0, 500);
}

export const CSV_TEMPLATE = `name,description,price,discountPrice,isVeg,spiceLevel,tags
Paneer Tikka,Cottage cheese tikka,249,199,true,mild,bestseller;veg
Chicken 65,Spicy fried chicken,279,,false,hot,spicy;nonveg`;
