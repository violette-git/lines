// Native delivery (Android / iOS). Metro picks deliver.web.ts on web.
// APIs checked against installed type definitions:
//   expo-file-system 58: new File(Paths.cache, name), file.create({ overwrite }), await file.write(Uint8Array | string), file.move()
//   expo-sharing 58:     isAvailableAsync(), shareAsync(url, { mimeType, UTI, dialogTitle })
//   expo-print 58:       printToFileAsync({ html, width, height, margins }) -> { uri }
import { File, Paths } from 'expo-file-system';
import { printToFileAsync } from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import type { BuiltExport } from './build';

export interface DeliveryResult {
  fileName: string;
  uri?: string;
}

/** US Letter at 72 dpi. */
const LETTER = { width: 612, height: 792 };
/** iOS ignores CSS @page margins, so pass them explicitly there (points). Android honors @page. */
const IOS_MARGINS = { top: 40, right: 36, bottom: 40, left: 36 };

async function share(uri: string, built: BuiltExport): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) return;
  await Sharing.shareAsync(uri, {
    mimeType: built.type.mimeType,
    ...(built.type.uti ? { UTI: built.type.uti } : {}),
    dialogTitle: built.fileName,
  });
}

export async function deliver(built: BuiltExport): Promise<DeliveryResult> {
  if (built.kind === 'html-pdf') {
    const result = await printToFileAsync({
      html: built.html,
      ...LETTER,
      ...(Platform.OS === 'ios' ? { margins: IOS_MARGINS } : {}),
    });
    let uri = result.uri;
    // printToFileAsync writes a random name; rename so the shared file is "<project>_<date>.pdf".
    try {
      const printed = new File(result.uri);
      await printed.move(new File(Paths.cache, built.fileName), { overwrite: true });
      uri = printed.uri;
    } catch {
      // Keep the original printed file if renaming fails.
    }
    await share(uri, built);
    return { fileName: built.fileName, uri };
  }

  const file = new File(Paths.cache, built.fileName);
  file.create({ overwrite: true, intermediates: true });
  await file.write(built.data);
  await share(file.uri, built);
  return { fileName: built.fileName, uri: file.uri };
}
