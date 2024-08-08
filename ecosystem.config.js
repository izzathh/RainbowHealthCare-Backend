module.exports = {
    apps: [
        {
            name: "Rainbow Health Finder",
            script: "./index.js",
            watch: true,
            output: "logs/out.txt",
            error: "logs/error.txt",
            log: "logs/combined.outerr.txt",
            ignore_watch: ['logs/*', 'messages/*', 'monitor-api-usage.json'],
        }
    ]
}