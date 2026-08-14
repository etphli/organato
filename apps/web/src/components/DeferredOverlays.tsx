import { useOrganatoUi } from "../state/OrganatoProvider";
import { CommandPalette } from "./CommandPalette";
import { Inspector } from "./Inspector";
import { SearchOverlay } from "./SearchOverlay";

export function DeferredOverlays() {
  const { selectedItem, commandOpen, searchOpen } = useOrganatoUi();

  return (
    <>
      {selectedItem ? <Inspector /> : null}
      {commandOpen ? <CommandPalette /> : null}
      {searchOpen ? <SearchOverlay /> : null}
    </>
  );
}
