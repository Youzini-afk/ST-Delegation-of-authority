const path = require('node:path');

/** @type {import('webpack').Configuration} */
module.exports = {
    mode: 'development',
    target: 'node',
    entry: path.resolve(__dirname, 'src/index.ts'),
    output: {
        path: path.resolve(__dirname, 'dist/authority'),
        filename: 'index.cjs',
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
