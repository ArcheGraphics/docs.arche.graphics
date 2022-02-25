// @ts-check
// Note: type annotations allow type checking and IDEs autocompletion

const lightCodeTheme = require('prism-react-renderer/themes/nightOwl');
const darkCodeTheme = require('prism-react-renderer/themes/nightOwl');

/** @type {import('@docusaurus/types').Config} */
const config = {
    title: 'Arche Graphics Docs',
    tagline: 'Cross-Platform Engine based on WebGPU(Dawn)',
    url: 'https://arche.graphics',
    baseUrl: '/',
    onBrokenLinks: 'throw',
    onBrokenMarkdownLinks: 'warn',
    favicon: 'img/logo.svg',
    organizationName: 'Arche Graphics', // Usually your GitHub org/user name.
    projectName: 'docs.arche.graphics', // Usually your repo name.

    i18n: {
        defaultLocale: 'en',
        locales: ['en', 'zh-Hans'],
    },

    themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
        ({
            hideableSidebar: true,
            // Optional banner
            // announcementBar: {
            //   id: 'under-construction-banner',
            //   content:
            //     'Please help us by contributing documentation, corrections and translations! Thank you 😃',
            //   backgroundColor: '#0891b2',
            //   textColor: '#E5E7EB',
            //   isCloseable: false,
            // },
            prism: {
                defaultLanguage: 'cpp',
                theme: lightCodeTheme,
                darkTheme: darkCodeTheme,
            },

            navbar: {
                title: "Arche Graphics",
                hideOnScroll: false,
                logo: {
                    alt: 'Arche Graphics',
                    src: 'img/logo.svg',
                },
                items: [
                    {
                        type: 'doc',
                        docId: 'intro',
                        position: 'right',
                        label: 'Docs',
                    },
                    {
                        to: '/blog',
                        position: 'right',
                        label: 'Blog',
                    },
                    {
                        type: 'dropdown',
                        label: 'Playground',
                        position: 'right',
                        items: [
                            {
                                to: '/playground/skybox',
                                label: 'Playground.Skybox',
                            },
                            {
                                to: '/playground/cascade-shadow',
                                label: 'Playground.CascadeShadow',
                            },
                            {
                                to: '/playground/omni-shadow',
                                label: 'Playground.OmniShadow',
                            }
                        ]
                    },
                    {
                        type: 'localeDropdown',
                        position: 'right',
                        dropdownItemsBefore: [],
                        dropdownItemsAfter: [
                            // {to: '/versions', label: 'All versions'}
                        ],
                    },
                    {
                        href: 'https://github.com/ArcheGraphics',
                        label: 'GitHub',
                        position: 'right',
                    },
                ],
            },
            footer: {
                style: 'dark',
                links: [
                    {
                        title: 'Docs',
                        items: [
                            {
                                label: 'Tutorial',
                                to: '/docs/intro',
                            },
                        ],
                    },
                    {
                        title: 'Community',
                        items: [
                            {
                                label: 'Zhihu',
                                href: 'https://www.zhihu.com/column/c_1026053199056265216',
                            },
                        ],
                    },
                    {
                        title: 'More',
                        items: [
                            {
                                label: 'Blog',
                                to: '/blog',
                            },
                            {
                                label: 'GitHub',
                                href: 'https://github.com/ArcheGraphics',
                            },
                        ],
                    },
                ],
                copyright: `Copyright © ${new Date().getFullYear()} Arche Graphics. Built with Docusaurus.`,
            },
            colorMode: {
                switchConfig: {
                    darkIcon: '🌙',
                    lightIcon: '☀️',
                }
            },
        }),

    presets: [
        [
            'classic',
            /** @type {import('@docusaurus/preset-classic').Options} */
            ({
                docs: {
                    sidebarPath: require.resolve('./sidebars.js'),
                    // Please change this to your repo.
                    editUrl: 'https://github.com/facebook/docusaurus/tree/main/packages/create-docusaurus/templates/shared/',
                    editCurrentVersion: true,
                    showLastUpdateAuthor: true,
                    showLastUpdateTime: true,
                    versions: {
                        current: {
                            label: 'develop',
                        },
                    },
                },
                blog: {
                    showReadingTime: true,
                    // Please change this to your repo.
                    editUrl:
                        'https://github.com/facebook/docusaurus/tree/main/packages/create-docusaurus/templates/shared/',
                },
                theme: {
                    customCss: require.resolve('./src/css/custom.css'),
                },
            }),
        ],
    ],
};

module.exports = config;
