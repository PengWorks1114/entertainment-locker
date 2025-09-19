import ItemForm from "@/components/ItemForm";

type SearchParams = Record<string, string | string[] | undefined>;

type NewItemPageProps = {
  searchParams?: Promise<SearchParams> | SearchParams;
};

export default async function NewItemPage({ searchParams }: NewItemPageProps) {
  const resolvedSearchParams = await searchParams;
  const cabinetIdParam = resolvedSearchParams?.cabinetId;
  const cabinetId =
    typeof cabinetIdParam === "string"
      ? cabinetIdParam
      : Array.isArray(cabinetIdParam)
        ? cabinetIdParam[0]
        : undefined;

  return <ItemForm initialCabinetId={cabinetId} />;
}
