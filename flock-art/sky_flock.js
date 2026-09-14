(function () {
  const sketch = (p) => {
    let prey = [];
    let predators = [];
    let holder;
    let attractor;

    const trailMs = 2000;
    const preyCount = 82;
    const predatorCount = 2;

    p.setup = function () {
      holder = document.getElementById("sky-flock");
      const size = getCanvasSize();
      const canvas = p.createCanvas(size, size);
      canvas.parent(holder);
      attractor = p.createVector(p.width / 2, p.height / 2);
      seedFlock();
    };

    p.draw = function () {
      p.clear();

      for (const bird of prey) {
        bird.flock(prey, predators);
        bird.update();
        bird.drawTrail();
      }

      for (const bird of prey) {
        bird.draw();
      }

      for (const predator of predators) {
        predator.flock(prey, predators);
        predator.update();
        predator.draw();
      }
    };

    p.windowResized = function () {
      const size = getCanvasSize();
      p.resizeCanvas(size, size);
      attractor.set(p.width / 2, p.height / 2);
      keepInside(prey);
      keepInside(predators);
    };

    function getCanvasSize() {
      if (!holder) return 360;
      return Math.max(240, Math.round(holder.getBoundingClientRect().width));
    }

    function seedFlock() {
      prey = Array.from({ length: preyCount }, () => new Bird(false));
      predators = Array.from({ length: predatorCount }, () => new Bird(true));
    }

    function keepInside(birds) {
      const center = p.createVector(p.width / 2, p.height / 2);
      const radius = p.width * 0.48;

      for (const bird of birds) {
        const offset = p5.Vector.sub(bird.position, center);
        if (offset.mag() > radius) {
          offset.setMag(radius * p.random(0.55, 0.92));
          bird.position = p5.Vector.add(center, offset);
        }
      }
    }

    class Bird {
      constructor(isPredator) {
        this.isPredator = isPredator;
        this.position = randomPointInCircle();
        this.velocity = p5.Vector.random2D().mult(isPredator ? p.random(2.2, 3.6) : p.random(1.0, 2.1));
        this.acceleration = p.createVector();
        this.baseMaxSpeed = isPredator ? p.random(2.3, 3.7) : p.random(1.1, 2.4);
        this.maxSpeed = this.baseMaxSpeed;
        this.maxForce = isPredator ? 0.075 : 0.045;
        this.size = isPredator ? 5.5 : 1.7;
        this.separationDist = isPredator ? 92 : 12;
        this.alignDist = isPredator ? 120 : 58;
        this.cohesionDist = isPredator ? 90 : 70;
        this.separationWeight = isPredator ? 1.8 : 1.45;
        this.alignWeight = isPredator ? 0.7 : 0.95;
        this.cohesionWeight = isPredator ? 0.35 : 0.9;
        this.flapSpeed = isPredator ? 0.23 : 0.18;
        this.flapAmp = isPredator ? 14 : 5;
        this.flapPhase = p.random(p.TWO_PI);
        this.noiseOffset = p.random(1000);
        this.trail = [];
      }

      flock(flockmates, hunters) {
        if (this.isPredator) {
          this.applyForce(this.chase(flockmates).mult(1.15));
          this.applyForce(this.separate(hunters).mult(this.separationWeight));
          this.applyForce(this.seek(attractor).mult(0.01));
        } else {
          this.applyForce(this.separate(flockmates).mult(this.separationWeight));
          this.applyForce(this.align(flockmates).mult(this.alignWeight));
          this.applyForce(this.cohere(flockmates).mult(this.cohesionWeight));
          this.applyForce(this.flee(hunters).mult(2.7));
          this.applyForce(this.seek(attractor).mult(0.006));
        }

        const nx = (p.noise(this.position.x * 0.006 + this.noiseOffset, this.position.y * 0.006) * 2 - 1) * 0.18;
        const ny = (p.noise(this.position.y * 0.006 + this.noiseOffset, this.position.x * 0.006) * 2 - 1) * 0.18;
        this.applyForce(p.createVector(nx, ny));
        this.avoidCircleEdge();
      }

      update() {
        this.maxSpeed = this.velocity.y < 0 ? this.baseMaxSpeed * 0.82 : this.baseMaxSpeed * 1.16;
        this.velocity.add(this.acceleration).limit(this.maxSpeed);
        this.position.add(this.velocity);
        this.acceleration.set(0, 0);
        this.flapPhase = (this.flapPhase + this.flapSpeed + this.velocity.mag() * 0.04) % p.TWO_PI;

        if (!this.isPredator) {
          const now = p.millis();
          this.trail.push({ x: this.position.x, y: this.position.y, t: now });
          this.trail = this.trail.filter((point) => now - point.t <= trailMs);
        }
      }

      applyForce(force) {
        this.acceleration.add(force);
      }

      avoidCircleEdge() {
        const center = p.createVector(p.width / 2, p.height / 2);
        const radius = p.width * 0.48;
        const offset = p5.Vector.sub(this.position, center);
        const distance = offset.mag();

        if (distance > radius * 0.82) {
          const inward = p5.Vector.sub(center, this.position);
          inward.setMag(p.map(distance, radius * 0.82, radius, 0.015, this.maxForce * 2.4, true));
          this.applyForce(inward);
        }

        if (distance > radius + 8) {
          offset.setMag(radius - 6);
          this.position = p5.Vector.add(center, offset);
          this.velocity.rotate(p.PI * 0.7);
        }
      }

      separate(flockmates) {
        const steer = p.createVector();
        let count = 0;

        for (const other of flockmates) {
          if (other === this) continue;
          const distance = this.position.dist(other.position);
          if (distance > 0 && distance < this.separationDist) {
            const diff = p5.Vector.sub(this.position, other.position).normalize().div(distance);
            steer.add(diff);
            count++;
          }
        }

        if (count > 0) steer.div(count);
        return this.steerFromVector(steer);
      }

      align(flockmates) {
        const sum = p.createVector();
        let count = 0;

        for (const other of flockmates) {
          if (other === this) continue;
          const distance = this.position.dist(other.position);
          if (distance > 0 && distance < this.alignDist) {
            sum.add(other.velocity);
            count++;
          }
        }

        if (count === 0) return p.createVector();
        sum.div(count).normalize().mult(this.maxSpeed);
        return sum.sub(this.velocity).limit(this.maxForce);
      }

      cohere(flockmates) {
        const sum = p.createVector();
        let count = 0;

        for (const other of flockmates) {
          if (other === this) continue;
          const distance = this.position.dist(other.position);
          if (distance > 0 && distance < this.cohesionDist) {
            sum.add(other.position);
            count++;
          }
        }

        if (count === 0) return p.createVector();
        return this.seek(sum.div(count));
      }

      seek(target) {
        const desired = p5.Vector.sub(target, this.position);
        if (desired.magSq() === 0) return p.createVector();
        desired.normalize().mult(this.maxSpeed);
        return desired.sub(this.velocity).limit(this.maxForce);
      }

      flee(hunters) {
        const steer = p.createVector();
        let count = 0;

        for (const hunter of hunters) {
          const distance = this.position.dist(hunter.position);
          if (distance > 0 && distance < p.width * 0.22) {
            const diff = p5.Vector.sub(this.position, hunter.position).normalize().div(distance);
            steer.add(diff);
            count++;
          }
        }

        if (count > 0) steer.div(count);
        return this.steerFromVector(steer, 2.4);
      }

      chase(flockmates) {
        if (flockmates.length === 0) return p.createVector();

        let closest = flockmates[0];
        let closestDistance = this.position.dist(closest.position);

        for (const bird of flockmates) {
          const distance = this.position.dist(bird.position);
          if (distance < closestDistance) {
            closest = bird;
            closestDistance = distance;
          }
        }

        return this.seek(closest.position);
      }

      steerFromVector(vector, forceScale = 1) {
        if (vector.magSq() === 0) return p.createVector();
        vector.normalize().mult(this.maxSpeed);
        return vector.sub(this.velocity).limit(this.maxForce * forceScale);
      }

      drawTrail() {
        if (this.trail.length < 2) return;

        const now = p.millis();
        p.noFill();
        p.strokeWeight(1);

        for (let i = 1; i < this.trail.length; i++) {
          const a = this.trail[i - 1];
          const b = this.trail[i];
          const age = now - b.t;
          const alpha = p.map(age, 0, trailMs, 58, 0, true);
          p.stroke(6, 24, 34, alpha);
          p.line(a.x, a.y, b.x, b.y);
        }
      }

      draw() {
        p.push();
        p.translate(this.position.x, this.position.y);
        p.rotate(this.velocity.heading());

        const flap = p.sin(this.flapPhase) * this.flapAmp;
        p.noStroke();
        p.fill(this.isPredator ? p.color(3, 15, 21, 230) : p.color(8, 35, 48, 205));

        p.beginShape();
        p.vertex(-this.size, 0);
        p.quadraticVertex(-this.size * 3, -flap, -this.size * 2, 0);
        p.quadraticVertex(-this.size * 3, flap, -this.size, 0);
        p.endShape(p.CLOSE);

        p.beginShape();
        p.vertex(-this.size, 0);
        p.quadraticVertex(-this.size * 3, flap, -this.size * 2, 0);
        p.quadraticVertex(-this.size * 3, -flap, -this.size, 0);
        p.endShape(p.CLOSE);

        p.pop();
      }
    }

    function randomPointInCircle() {
      const angle = p.random(p.TWO_PI);
      const radius = Math.sqrt(p.random()) * p.width * 0.42;
      return p.createVector(
        p.width / 2 + p.cos(angle) * radius,
        p.height / 2 + p.sin(angle) * radius
      );
    }
  };

  if (window.p5) {
    new window.p5(sketch);
  }
})();
