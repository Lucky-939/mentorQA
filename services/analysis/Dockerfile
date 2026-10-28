# Stage 1: Build Java Analyzer JAR
FROM maven:3.9-eclipse-temurin-17 AS java-builder

WORKDIR /build
COPY apps/java-analyzer/pom.xml .
COPY apps/java-analyzer/src ./src
RUN mvn clean package -DskipTests

# Stage 2: Python Analysis Runtime
FROM python:3.12-slim

WORKDIR /app

# Install default JRE and curl for health checks
RUN apt-get update && apt-get install -y --no-install-recommends default-jre curl && rm -rf /var/lib/apt/lists/*

# Install Python dependencies first for layer caching
COPY services/analysis/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy built Java analyzer JAR to /app/bin/java-analyzer.jar
RUN mkdir -p /app/bin
COPY --from=java-builder /build/target/java-analyzer-1.0-SNAPSHOT-jar-with-dependencies.jar /app/bin/java-analyzer.jar

# Copy analysis service source code
COPY services/analysis/ .

ENV JAVA_ANALYZER_JAR=/app/bin/java-analyzer.jar

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
