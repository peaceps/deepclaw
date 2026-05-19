import {ReactElement} from 'react';
import {Text, Box} from 'ink';
import { useTranslation } from 'react-i18next';

export const banner = `
╔=========================================================================╗
║ ██████╗ ███████╗███████╗██████╗   ♦   ██████╗██╗      █████╗ ██╗    ██╗ ║
║ ██╔══██╗██╔════╝██╔════╝██╔══██╗  ♦  ██╔════╝██║     ██╔══██╗██║    ██║ ║
║ ██║  ██║█████╗  █████╗  ██████╔╝ ♦♦♦ ██║     ██║     ███████║██║ █╗ ██║ ║
║ ██║  ██║██╔══╝  ██╔══╝  ██╔═══╝   ♦  ██║     ██║     ██╔══██║██║███╗██║ ║
║ ██████╔╝███████╗███████╗██║       ♦   ██████╗███████╗██║  ██║╚███╔███╔╝ ║
║ ╚═════╝ ╚══════╝╚══════╝╚═╝            ╚═════╝╚══════╝╚═╝  ╚═╝ ╚══╝╚══╝ ║
╚=========================================================================╝
`;

export default function Banner(): ReactElement {
    const {t} = useTranslation();
	return (
		<Box flexDirection='column'>
			<Text color="#98C379">{banner}</Text>
			<Text color="yellow">
				✨ {t('banner.prefix')} <Text color="cyan">Enter</Text> {t('banner.suffix')}{'\n'}
			</Text>
		</Box>
	);
}
