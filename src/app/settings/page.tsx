import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ObjectId } from "mongodb";
import { auth } from "@/lib/auth";
import { usersCol } from "@/lib/mongodb";
import { docId } from "@/lib/mongodb/prompt-helpers";
import config from "@/../prompts.config";
import { ProfileForm } from "@/components/settings/profile-form";
import { ApiKeySettings } from "@/components/settings/api-key-settings";
import type { CustomLink } from "@/components/user/profile-links";

export default async function SettingsPage() {
  const session = await auth();
  const t = await getTranslations("settings");

  if (!session?.user) {
    redirect("/login");
  }

  const userDoc = await usersCol().findOne({ _id: new ObjectId(session.user.id) });

  if (!userDoc) {
    redirect("/login");
  }

  const user = {
    id: docId(userDoc),
    name: userDoc.name,
    username: userDoc.username,
    email: userDoc.email,
    avatar: userDoc.avatar,
    verified: userDoc.verified,
    apiKey: userDoc.apiKey,
    mcpPromptsPublicByDefault: userDoc.mcpPromptsPublicByDefault,
    bio: userDoc.bio,
    customLinks: userDoc.customLinks as CustomLink[] | null,
  };

  return (
    <div className="container max-w-2xl py-6">
      <div className="mb-6">
        <h1 className="text-lg font-semibold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("description")}
        </p>
      </div>

      <div className="space-y-6">
        <ProfileForm
          user={user}
          showVerifiedSection={!config.homepage?.useCloneBranding}
        />

        {config.features.mcp !== false && (
          <ApiKeySettings
            initialApiKey={user.apiKey}
            initialPublicByDefault={user.mcpPromptsPublicByDefault}
          />
        )}
      </div>
    </div>
  );
}
