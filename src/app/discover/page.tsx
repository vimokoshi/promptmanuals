import { DiscoveryPrompts } from "@/components/prompts/discovery-prompts";
import { StructuredData } from "@/components/seo/structured-data";
import { promptsCol } from "@/lib/mongodb";
import { docId } from "@/lib/mongodb/prompt-helpers";

export default async function DiscoverPage() {
  // Fetch top prompts for structured data
  const topDocs = await promptsCol()
    .find({ isPrivate: false, isUnlisted: false, deletedAt: null })
    .sort({ voteCount: -1 })
    .limit(10)
    .project({ _id: 1, title: 1, description: 1, slug: 1 })
    .toArray();

  const itemListData = topDocs.map((prompt) => ({
    name: prompt.title as string,
    url: `/prompts/${docId(prompt)}${prompt.slug ? `_${prompt.slug}` : ""}`,
    description: (prompt.description as string | null) || undefined,
  }));

  return (
    <>
      <StructuredData
        type="itemList"
        data={{ items: itemListData }}
      />
      <StructuredData
        type="breadcrumb"
        data={{
          breadcrumbs: [
            { name: "Home", url: "/" },
            { name: "Discover", url: "/discover" },
          ],
        }}
      />
      <div className="flex flex-col">
        <DiscoveryPrompts />
      </div>
    </>
  );
}
