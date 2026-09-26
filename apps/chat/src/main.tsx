import { mountMattstackApp } from '@mattstack/app-kit/app';

import './app/icons';

import { App } from './app/App';
import { chatFontTheme } from './app/chat-font-theme';

mountMattstackApp(<App />, { theme: chatFontTheme });
