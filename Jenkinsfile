pipeline {
    agent any

    environment {
        // 获取git提交sha、分支信息
        GIT_COMMIT_SHA = sh(script: 'git rev-parse --short HEAD', returnStdout: true).trim()
        // 根据分支区分环境
        BUILD_ENV = env.GIT_BRANCH == 'origin/main' ? 'prod' : 'dev'
        // 如果使用docker镜像，替换为你的镜像仓库地址
        DOCKER_IMAGE = "harbor.example.com/frontend/vue3-ts-demo:${GIT_COMMIT_SHA}"
    }

    stages {
        stage('检出代码') {
            steps {
                checkout scm
            }
        }

        stage('安装依赖 & ESLint + TS类型检查') {
            steps {
                sh '''
                    node -v
                    npm -v
                    # npm ci 根据package‑lock.json严格安装依赖，保证CI与本地版本一致
                    npm ci
                    npm run lint
                    npm run type-check
                '''
            }
        }

        stage('单元测试') {
            steps {
                sh 'npm run test:watch'
            }
        }

        stage('构建打包') {
            steps {
                sh '''
                    if [ "${BUILD_ENV}" = "prod" ];then
                        npm run build:prod
                    else
                        npm run build:dev
                    fi
                '''
            }
        }

        // -------- 方案1：静态资源部署 OSS/COS（大部分前端项目用这个） --------
        stage('部署测试环境 OSS') {
            when {
                branch 'develop'
            }
            steps {
                echo "将dist目录上传到测试OSS"
                // 替换为你的上传脚本，例如 node scripts/upload-oss.js --env dev
                sh 'node ./scripts/upload‑oss.js --env dev'
            }
        }

        stage('生产环境发布(人工审批)') {
            when {
                branch 'main'
            }
            steps {
                input message: '确认发布生产环境？', ok: '确认发布'
                sh 'node ./scripts/upload‑oss.js --env prod'
            }
        }

        // -------- 方案2：Docker镜像构建推送（K8s容器部署，按需打开注释使用） --------
//        stage('构建并推送Docker镜像') {
//            steps {
//                sh """
//                    docker build -t ${DOCKER_IMAGE} .
//                    docker push ${DOCKER_IMAGE}
//                """
//            }
//        }
    }

    post {
        always {
            echo "流水线结束，commit: ${GIT_COMMIT_SHA}, env: ${BUILD_ENV}"
            cleanWs() // 清理工作空间，防止磁盘占用过高
        }
        success {
            echo "✅流水线执行成功"
        }
        failure {
            echo "❌流水线执行失败，请查看日志排查问题"
            // 这里可以配置企业微信/邮件通知
        }
    }
}
