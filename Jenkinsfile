pipeline {
    agent any

    stages {
        stage('检出代码') {
            steps {
                checkout scm
            }
        }

        // GIT_COMMIT/BUILD_ENV 依赖 checkout 之后才存在，所以在检出后统一设置
        stage('设置环境变量') {
            steps {
                script {
                    // 提交 sha：checkout 已完成，可以安全调用 git
                    env.GIT_COMMIT_SHA = sh(
                        script: 'git rev-parse --short HEAD',
                        returnStdout: true,
                    ).trim()
                    // 如果使用 docker 镜像，替换为你的镜像仓库地址
                    env.DOCKER_IMAGE = "harbor.example.com/frontend/vue3-ts-demo:${env.GIT_COMMIT_SHA}"

                    // 分支名优先取 Jenkins 注入的 BRANCH_NAME（多分支流水线 / 兼容 detached HEAD 场景）
                    def branch = env.BRANCH_NAME
                        ?: env.GIT_BRANCH?.replace('origin/', '')
                        ?: 'develop'
                    env.BUILD_ENV = (branch == 'master') ? 'prod' : 'dev'
                    echo "当前分支：${branch}，构建环境：${env.BUILD_ENV}"
                }
            }
        }

        // 注意：本项目 package.json 没有 lint 脚本（eslint 未配置），这里只做依赖安装与类型检查
        stage('安装依赖 & 类型检查') {
            steps {
                sh '''
                    /usr/local/bin/node node -v
                    npm -v
                    # npm ci 根据 package-lock.json 严格安装依赖，保证 CI 与本地版本一致
                    npm ci
                    npm run type-check
                    npm run type-check:tests
                '''
            }
        }

        stage('单元测试') {
            steps {
                // CI 用一次性运行（vitest run）；test:watch 是监听模式，放进流水线会永不结束
                sh 'npm test'
            }
        }

        stage('构建打包') {
            steps {
                // 本项目仅一个构建命令；若需要按环境区分产物，再引入 vite --mode prod/dev
                sh 'npm run build'
            }
        }

        // -------- 方案1：静态资源部署 OSS/COS（大部分前端项目用这个） --------
        // stage('部署测试环境 OSS') {
        //     when {
        //         branch 'develop'
        //     }
        //     steps {
        //         echo '将dist目录上传到测试OSS'
        //         // 替换为你的上传脚本，例如 node scripts/upload-oss.js --env dev
        //         sh 'node ./scripts/upload‑oss.js --env dev'
        //         // echo '将 dist 目录上传到测试 OSS'
        //         // script {
        //         //     if (fileExists('scripts/upload-oss.js')) {
        //         //         sh 'node ./scripts/upload-oss.js --env dev'
        //         //     } else {
        //         //         echo '未找到 scripts/upload-oss.js，跳过上传（占位脚本未就绪）'
        //         //     }
        //         // }
        //     }
        // }

        // stage('生产环境发布(人工审批)') {
        //     when {
        //         branch 'main'
        //     }
        //     steps {
        //         input message: '确认发布生产环境？', ok: '确认发布'
        //         script {
        //             if (fileExists('scripts/upload-oss.js')) {
        //                 sh 'node ./scripts/upload-oss.js --env prod'
        //             } else {
        //                 echo '未找到 scripts/upload-oss.js，跳过上传（占位脚本未就绪）'
        //             }
        //         }
        //     }
        // }

    // -------- 方案2：Docker 镜像构建推送（K8s 容器部署，按需打开注释使用） --------
    //        stage('构建并推送Docker镜像') {
    //            steps {
    //                sh """
    //                    docker build -t ${env.DOCKER_IMAGE} .
    //                    docker push ${env.DOCKER_IMAGE}
    //                """
    //            }
    //        }
    }

    post {
        always {
            echo "流水线结束，commit: ${env.GIT_COMMIT_SHA ?: 'N/A'}, env: ${env.BUILD_ENV ?: 'N/A'}"
            cleanWs() // 清理工作空间，防止磁盘占用过高（需要 Workspace Cleanup 插件）
        }
        success {
            echo '✅ 流水线执行成功'
        }
        failure {
            echo '❌ 流水线执行失败，请查看日志排查问题'
        // 这里可以配置企业微信/邮件通知
        }
    }
}
