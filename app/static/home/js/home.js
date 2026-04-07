document.addEventListener('DOMContentLoaded', () => {
    // Particle animation
    const canvas = document.getElementById('particleCanvas');
    if (canvas) {
        const ctx = canvas.getContext('2d');
        canvas.width = canvas.offsetWidth;
        canvas.height = canvas.offsetHeight;

        const particles = [];
        const particleCount = 50;

        class Particle {
            constructor() {
                this.x = Math.random() * canvas.width;
                this.y = Math.random() * canvas.height;
                this.size = Math.random() * 2 + 0.5;
                this.speedX = (Math.random() - 0.5) * 0.8;
                this.speedY = (Math.random() - 0.5) * 0.8;
                this.opacity = Math.random() * 0.5 + 0.2;
                this.color = ['rgba(124, 58, 237', 'rgba(0, 212, 170', 'rgba(34, 197, 94'][Math.floor(Math.random() * 3)];
            }

            update() {
                this.x += this.speedX;
                this.y += this.speedY;

                if (this.x > canvas.width) this.x = 0;
                if (this.x < 0) this.x = canvas.width;
                if (this.y > canvas.height) this.y = 0;
                if (this.y < 0) this.y = canvas.height;
            }

            draw() {
                ctx.fillStyle = `${this.color}, ${this.opacity})`;
                ctx.fillRect(this.x, this.y, this.size, this.size);
            }
        }

        for (let i = 0; i < particleCount; i++) {
            particles.push(new Particle());
        }

        function animate() {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            particles.forEach(particle => {
                particle.update();
                particle.draw();
            });
            requestAnimationFrame(animate);
        }
        animate();

        window.addEventListener('resize', () => {
            canvas.width = canvas.offsetWidth;
            canvas.height = canvas.offsetHeight;
        });
    }

    // Health check
    const healthMessage = document.getElementById('healthMessage');

    const setStatus = (online, message) => {
        if (!healthMessage) return;
        healthMessage.textContent = message;
    };

    async function checkHealth() {
        try {
            const res = await fetch('/health');
            if (!res.ok) throw new Error('API responded with ' + res.status);
            setStatus(true, 'Backend healthy and running');
        } catch (err) {
            setStatus(false, 'Backend connecting...');
        }
    }

    checkHealth();
});

