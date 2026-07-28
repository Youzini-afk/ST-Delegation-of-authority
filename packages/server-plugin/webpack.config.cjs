const path = require('node:path');

/** @type {import('webpack').Configuration} */
module.exports = {
    mode: 'development',
    target: 'node',
    entry: {
        index: path.resolve(__dirname, 'src/index.ts'),
        agent: path.resolve(__dirname, 'src/agent-cli.ts'),
    },
    output: {
        path: path.resolve(__dirname, 'dist/authority'),
        filename: '[name].cjs',
        library: {
            type: 'commonjs2',
        },
        clean: true,
    },
    resolve: {
        extensions: ['.ts', '.js'],
        extensionAlias: {
            '.js': ['.ts', '.js'],
        },
    },
    module: {
        rules: [
            {
                test: /\.ts$/,
                use: {
                    loader: 'ts-loader',
                    options: {
                        configFile: path.resolve(__dirname, 'tsconfig.json'),
                        transpileOnly: false,
                    },
                },
                exclude: /node_modules/,
            },
        ],
    },
    externalsPresets: { node: true },
    externals: {
        '@stdo/shared-types': 'commonjs @stdo/shared-types',
    },
    devtool: 'source-map',
};
