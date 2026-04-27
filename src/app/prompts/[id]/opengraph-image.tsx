import { ImageResponse } from "next/og";
import { ObjectId } from "mongodb";
import { promptsCol, usersCol, categoriesCol } from "@/lib/mongodb";
import { docId } from "@/lib/mongodb/prompt-helpers";
import { getConfig } from "@/lib/config";

export const alt = "Prompt Preview";
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";
export const revalidate = 3600;

const typeLabels: Record<string, string> = {
  TEXT: "Text Prompt",
  IMAGE: "Image Prompt",
  VIDEO: "Video Prompt",
  AUDIO: "Audio Prompt",
  STRUCTURED: "Structured",
};

const typeColors: Record<string, string> = {
  TEXT: "#3b82f6",
  IMAGE: "#8b5cf6",
  VIDEO: "#ec4899",
  AUDIO: "#f59e0b",
  STRUCTURED: "#10b981",
};

const radiusMap: Record<string, number> = {
  none: 0,
  sm: 8,
  md: 12,
  lg: 16,
};

/**
 * Extracts the prompt ID from a URL parameter that may contain a slug
 */
function extractPromptId(idParam: string): string {
  const underscoreIndex = idParam.indexOf("_");
  if (underscoreIndex !== -1) {
    return idParam.substring(0, underscoreIndex);
  }
  return idParam;
}

export default async function OGImage({ params }: { params: Promise<{ id: string }> }) {
  const { id: idParam } = await params;
  const id = extractPromptId(idParam);
  const config = await getConfig();
  const radius = radiusMap[config.theme?.radius || "sm"] || 8;
  const radiusLg = radius * 2;

  let oid: ObjectId;
  try {
    oid = new ObjectId(id);
  } catch {
    return new ImageResponse(
      (
        <div
          style={{
            height: "100%",
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "#0a0a0a",
            color: "#fff",
            fontSize: 48,
            fontWeight: 600,
          }}
        >
          Prompt Not Found
        </div>
      ),
      { ...size }
    );
  }

  const doc = await promptsCol().findOne({ _id: oid });

  if (!doc) {
    return new ImageResponse(
      (
        <div
          style={{
            height: "100%",
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "#0a0a0a",
            color: "#fff",
            fontSize: 48,
            fontWeight: 600,
          }}
        >
          Prompt Not Found
        </div>
      ),
      { ...size }
    );
  }

  // Fetch author and category
  const [authorDoc, categoryDoc] = await Promise.all([
    usersCol().findOne({ _id: { $in: [doc.authorId] } } as Record<string, unknown>),
    doc.categoryId
      ? categoriesCol().findOne({ _id: { $in: [doc.categoryId] } } as Record<string, unknown>)
      : Promise.resolve(null),
  ]);

  const author = authorDoc
    ? { name: authorDoc.name, username: authorDoc.username, avatar: authorDoc.avatar }
    : { name: null, username: doc.authorId, avatar: null };

  const category = categoryDoc
    ? { name: categoryDoc.name, icon: categoryDoc.icon }
    : null;

  const voteCount = doc.voteCount;

  // For structured prompts, try to prettify JSON/YAML
  let displayContent = doc.content;
  if (doc.type === "STRUCTURED") {
    try {
      if (doc.structuredFormat === "JSON") {
        const parsed = JSON.parse(doc.content);
        displayContent = JSON.stringify(parsed, null, 2);
      }
    } catch {
      // Keep original if parsing fails
    }
  }

  const truncatedContent = displayContent.length > 400
    ? displayContent.slice(0, 400) + "..."
    : displayContent;

  const isImagePrompt = doc.type === "IMAGE" && doc.mediaUrl;
  const isStructuredPrompt = doc.type === "STRUCTURED";

  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          backgroundColor: "#ffffff",
          padding: "48px 56px",
        }}
      >
        {/* Top Bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 24,
          }}
        >
          {/* Left: Branding */}
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <span style={{ fontSize: 24, fontWeight: 600, color: config.theme?.colors?.primary || "#6366f1" }}>
              {config.branding.name}
            </span>
          </div>

          {/* Right: Stats */}
          <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
            {/* Upvotes */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={config.theme?.colors?.primary || "#6366f1"} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="m18 15-6-6-6 6" />
              </svg>
              <span style={{ fontSize: 24, fontWeight: 600, color: config.theme?.colors?.primary || "#6366f1" }}>
                {voteCount}
              </span>
            </div>
          </div>
        </div>

        {/* Main Content Area */}
        <div
          style={{
            display: "flex",
            flex: 1,
            gap: 40,
          }}
        >
          {/* Left Content */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              flex: 1,
            }}
          >
            {/* Title Row with Category and Type Badge */}
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                gap: 20,
                marginBottom: 16,
              }}
            >
              <div
                style={{
                  display: "flex",
                  fontSize: 48,
                  fontWeight: 700,
                  color: "#18181b",
                  lineHeight: 1.2,
                  letterSpacing: "-0.02em",
                  flex: 1,
                }}
              >
                {doc.title}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                {/* Category Badge */}
                {category && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      backgroundColor: "#f4f4f5",
                      color: "#71717a",
                      padding: "8px 14px",
                      borderRadius: radius * 2.5,
                      fontSize: 20,
                      fontWeight: 500,
                    }}
                  >
                    {category.icon && <span>{category.icon}</span>}
                    <span>{category.name}</span>
                  </div>
                )}
                {/* Type Badge */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    backgroundColor: typeColors[doc.type] + "30",
                    color: typeColors[doc.type],
                    padding: "8px 16px",
                    borderRadius: radius * 2.5,
                    fontSize: 20,
                    fontWeight: 600,
                  }}
                >
                  {typeLabels[doc.type] || doc.type}
                </div>
              </div>
            </div>

            {/* Content Preview */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                fontSize: isStructuredPrompt ? 18 : 22,
                color: "#3f3f46",
                lineHeight: isStructuredPrompt ? 1.4 : 1.6,
                flex: 1,
                backgroundColor: "#fafafa",
                padding: "12px 14px",
                borderRadius: radius,
                border: `2px solid ${config.theme?.colors?.primary || "#6366f1"}20`,
                overflow: "hidden",
              }}
            >
              {isStructuredPrompt && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginBottom: 12,
                    paddingBottom: 12,
                    borderBottom: "1px solid #e4e4e7",
                  }}
                >
                  <span style={{ color: config.theme?.colors?.primary || "#6366f1", fontWeight: 600, fontSize: 14 }}>
                    {doc.structuredFormat || "JSON"}
                  </span>
                </div>
              )}
              <div style={{ display: "flex", whiteSpace: isStructuredPrompt ? "pre" : "pre-wrap" }}>
                {truncatedContent}
              </div>
            </div>

            {/* Footer - Author Info */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-end",
                marginTop: 20,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                {/* Avatar */}
                {author.avatar ? (
                  <img
                    src={author.avatar}
                    width={48}
                    height={48}
                    style={{ borderRadius: 24, border: "2px solid #e4e4e7" }}
                  />
                ) : (
                  <div
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: 24,
                      backgroundColor: "#f4f4f5",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#71717a",
                      fontSize: 20,
                      fontWeight: 600,
                      border: "2px solid #e4e4e7",
                    }}
                  >
                    {(author.name || author.username).charAt(0).toUpperCase()}
                  </div>
                )}
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <span style={{ color: "#18181b", fontSize: 20, fontWeight: 600 }}>
                    {author.name || author.username}
                  </span>
                  <span style={{ color: "#71717a", fontSize: 16 }}>
                    @{author.username}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Image Preview (for image prompts) */}
          {isImagePrompt && (
            <img
              src={doc.mediaUrl!}
              width={280}
              height={420}
              style={{
                borderRadius: radiusLg,
                objectFit: "cover",
                objectPosition: "center",
                border: "2px solid #e4e4e7",
              }}
            />
          )}
        </div>
      </div>
    ),
    { ...size }
  );
}
