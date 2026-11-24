import { Bot } from "lucide-react";
import type { IdentityReference } from "../../shared/types";
import { identityPresentation } from "../../client/pioneer/profiles";
import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar";

export function IdentityAvatar({
  identity,
  className,
  ...props
}: React.ComponentProps<typeof Avatar> & { identity: IdentityReference }) {
  const { name, label, avatarUrl } = identityPresentation(identity);
  return (
    <Avatar aria-label={label} className={className} {...props}>
      {avatarUrl && (
        <AvatarImage
          src={avatarUrl}
          alt=""
        />
      )}
      <AvatarFallback className="text-xs">
        {identity.type === "agent" ? (
          <Bot className="size-4" aria-hidden />
        ) : (
          Array.from(name)[0]?.toUpperCase()
        )}
      </AvatarFallback>
    </Avatar>
  );
}
